using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text.RegularExpressions;
using System.Threading;

namespace Contoso.Sample.Plugins
{
    /// <summary>
    /// The texts users read (refusals, error messages), one JSON bundle per language embedded in the
    /// assembly: Strings/messages.{code}.json, flat "key": "text" with {name} placeholders, and
    /// Strings/languages.json naming the source language and the languages offered.
    ///
    /// Loaded once per sandbox process into an immutable catalogue. That is the one kind of static state
    /// a plug-in may hold: read-only data from its own assembly, never anything from a request.
    /// </summary>
    public static class Messages
    {
        private static readonly Lazy<Catalogue> Loaded = new(Load, LazyThreadSafetyMode.ExecutionAndPublication);
        private static readonly Regex Placeholder = new(@"\{([A-Za-z][A-Za-z0-9]*)\}", RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100));

        /// <summary>The language strings are written in first, and the fallback for everything else.</summary>
        public static string SourceLanguage => Loaded.Value.Source;

        /// <summary>The offered languages, as configured in languages.json.</summary>
        public static IReadOnlyList<string> Languages => Loaded.Value.Languages;

        /// <summary>Every key and text of one language's bundle (tests compare bundles with the source).</summary>
        public static IReadOnlyDictionary<string, string> Bundle(string language) =>
            Loaded.Value.Bundles.TryGetValue(language, out var bundle) ? bundle : new Dictionary<string, string>();

        /// <summary>
        /// The text for a key in a language, placeholders filled in. Falls back to the source language,
        /// then to the key itself, so a missing translation never breaks the operation.
        /// </summary>
        public static string Format(string key, string language, IReadOnlyDictionary<string, string>? values = null)
        {
            var catalogue = Loaded.Value;
            if (!(catalogue.Bundles.TryGetValue(language, out var bundle) && bundle.TryGetValue(key, out var text))
                && !(catalogue.Bundles.TryGetValue(catalogue.Source, out bundle) && bundle.TryGetValue(key, out text)))
            {
                text = key;
            }
            if (values is null || values.Count == 0) return text!;
            return Placeholder.Replace(text!, match => values.TryGetValue(match.Groups[1].Value, out var value) ? value : match.Value);
        }

        /// <summary>
        /// The offered language for a Dataverse language id (LCID, usersettings.uilanguageid): the exact
        /// culture (pt-BR) when offered, else the language (pt), else the source language.
        /// </summary>
        public static string LanguageFor(int lcid)
        {
            var catalogue = Loaded.Value;
            if (lcid <= 0) return catalogue.Source;
            try
            {
                var culture = CultureInfo.GetCultureInfo(lcid);
                foreach (var candidate in new[] { culture.Name, culture.TwoLetterISOLanguageName })
                {
                    var match = catalogue.Languages.FirstOrDefault(code => string.Equals(code, candidate, StringComparison.OrdinalIgnoreCase));
                    if (match != null) return match;
                }
            }
            catch (CultureNotFoundException)
            {
                // An LCID the sandbox does not know: fall through to the source language.
            }
            return catalogue.Source;
        }

        private static Catalogue Load()
        {
            var assembly = typeof(Messages).Assembly;
            var prefix = assembly.GetName().Name + ".Strings.";
            var settings = new DataContractJsonSerializerSettings { UseSimpleDictionaryFormat = true };

            LanguageSettings config;
            using (var stream = assembly.GetManifestResourceStream(prefix + "languages.json")
                ?? throw new InvalidOperationException("Strings/languages.json is not embedded."))
            {
                config = (LanguageSettings)new DataContractJsonSerializer(typeof(LanguageSettings), settings).ReadObject(stream);
            }

            var bundles = new Dictionary<string, IReadOnlyDictionary<string, string>>(StringComparer.OrdinalIgnoreCase);
            foreach (var code in config.Offered ?? Array.Empty<string>())
            {
                using var stream = assembly.GetManifestResourceStream(prefix + "messages." + code + ".json");
                if (stream is null) continue; // the tests fail on a missing bundle; at run time the source language covers it
                var bundle = (Dictionary<string, string>)new DataContractJsonSerializer(typeof(Dictionary<string, string>), settings).ReadObject(stream);
                bundles[code] = new Dictionary<string, string>(bundle, StringComparer.Ordinal);
            }

            return new Catalogue(config.Source ?? "en", (config.Offered ?? Array.Empty<string>()).ToArray(), bundles);
        }

        private sealed class Catalogue
        {
            public Catalogue(string source, IReadOnlyList<string> languages, IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> bundles)
            {
                Source = source;
                Languages = languages;
                Bundles = bundles;
            }

            public string Source { get; }
            public IReadOnlyList<string> Languages { get; }
            public IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> Bundles { get; }
        }

        [DataContract]
        private sealed class LanguageSettings
        {
            [DataMember(Name = "source")]
            public string? Source { get; set; }

            [DataMember(Name = "languages")]
            public string[]? Offered { get; set; }
        }
    }
}

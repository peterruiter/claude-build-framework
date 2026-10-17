namespace App.Domain.Localization;

using System.Globalization;
using System.Reflection;
using System.Text.Json;

/// <summary>
/// The words a server-side document is written in: an email, a PDF, a calendar file.
/// </summary>
/// <remarks>
/// <para>
/// Bundles are JSON files named <c>{namespace}.{language}.json</c> in Localization/Resources, embedded in
/// the assembly. The web apps read the same files, so a key is translated once for both.
/// </para>
/// <para>
/// Every call carries its English as an argument rather than only a key, so a key nobody has translated
/// renders in English rather than as a key, and the English text sits next to the code that uses it.
/// </para>
/// <para>
/// Counted strings: the key itself is the "other" form, and <c>{key}.one</c>, <c>{key}.few</c>,
/// <c>{key}.many</c> (whichever categories the language needs, <see cref="PluralRules.Needed"/>) hold the
/// rest. <c>{0}</c> is the count.
/// </para>
/// </remarks>
public sealed class Localizer
{
    private const string ResourcePrefix = "App.Domain.Localization.Resources.";

    private readonly IReadOnlyDictionary<string, string> bundle;

    /// <summary>Opens one namespace in one language.</summary>
    /// <param name="ns">A namespace from locales.json, such as ui or email.</param>
    /// <param name="language">A code or culture. Anything not offered falls back to the default language.</param>
    public Localizer(string ns, string? language)
    {
        var locale = LocaleCatalogue.Resolve(language);
        Language = locale.Code;
        Culture = CultureInfo.GetCultureInfo(locale.Culture);
        bundle = Bundle(ns, Language);
    }

    /// <summary>The language this writes in.</summary>
    public string Language { get; }

    /// <summary>The culture numbers and dates are written in.</summary>
    public CultureInfo Culture { get; }

    /// <summary>The translation, or the English that was passed in.</summary>
    /// <param name="key">The key.</param>
    /// <param name="english">What to write when nothing has translated it.</param>
    public string this[string key, string english] =>
        bundle.TryGetValue(key, out var translated) && !string.IsNullOrWhiteSpace(translated) ? translated : english;

    /// <summary>A formatted translation: {0}, {1} and so on, in this language's culture.</summary>
    /// <param name="key">The key.</param>
    /// <param name="english">The English.</param>
    /// <param name="args">The values.</param>
    public string Format(string key, string english, params object?[] args) =>
        string.Format(Culture, this[key, english], args);

    /// <summary>A counted phrase, formatted: "1 item", "2 items"; in Polish three forms.</summary>
    /// <param name="key">The plural key.</param>
    /// <param name="english">The English plural, with {0} for the count.</param>
    /// <param name="englishOne">The English singular.</param>
    /// <param name="count">The count.</param>
    public string Count(string key, string english, string englishOne, long count) =>
        string.Format(Culture, Counted(key, english, englishOne, count), count);

    /// <summary>
    /// The unformatted text for a count: the category's form when this language has one, else the key
    /// itself, else the English given.
    /// </summary>
    /// <param name="key">The key; its own value is the "other" form.</param>
    /// <param name="english">The English plural.</param>
    /// <param name="englishOne">The English singular, or null where English has one form for every count.</param>
    /// <param name="count">The count.</param>
    public string Counted(string key, string english, string? englishOne, long count)
    {
        var category = PluralRules.Category(Culture.Name, count);
        if (category != PluralRules.Other && bundle.TryGetValue($"{key}.{category}", out var form) && !string.IsNullOrWhiteSpace(form)) return form;
        if (category == PluralRules.One && englishOne is not null && !bundle.ContainsKey(key)) return englishOne;
        return this[key, english];
    }

    /// <summary>One namespace in one language, as the web apps read it. Empty when there is none.</summary>
    /// <param name="ns">The namespace.</param>
    /// <param name="language">The language code.</param>
    public static IReadOnlyDictionary<string, string> Bundle(string ns, string language)
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream($"{ResourcePrefix}{ns}.{language}.json");
        if (stream is null) return new Dictionary<string, string>(StringComparer.Ordinal);

        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, string>>(stream) ?? new Dictionary<string, string>(StringComparer.Ordinal);
        }
        catch (JsonException)
        {
            // A malformed bundle degrades to English rather than taking the page with it. A test catches it first.
            return new Dictionary<string, string>(StringComparer.Ordinal);
        }
    }

    /// <summary>The names of every embedded bundle, such as ui.en.json: for the contract tests.</summary>
    public static IReadOnlyList<string> EmbeddedBundles() =>
        [.. Assembly.GetExecutingAssembly().GetManifestResourceNames()
            .Where(name => name.StartsWith(ResourcePrefix, StringComparison.Ordinal))
            .Select(name => name[ResourcePrefix.Length..])];
}

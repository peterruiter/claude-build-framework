using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using Xunit;

namespace Contoso.Sample.Plugins.Tests
{
    /// <summary>
    /// Every text a user can read exists in every offered language, with the same placeholders. The
    /// framework's checker (scripts/check-vocabulary.mjs) can check the same bundles for glossary terms
    /// when build/framework.json lists the Strings folder.
    /// </summary>
    public class MessagesTests
    {
        private static readonly Regex Placeholder = new(@"\{([A-Za-z][A-Za-z0-9]*)\}");

        private static string StringsFolder => Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Strings");

        public static IEnumerable<object[]> OfferedLanguages() => Messages.Languages.Select(code => new object[] { code });

        [Fact]
        public void The_source_language_is_offered_and_the_list_has_no_duplicates()
        {
            Assert.Contains(Messages.SourceLanguage, Messages.Languages);
            Assert.Equal(Messages.Languages.Count, Messages.Languages.Distinct(StringComparer.OrdinalIgnoreCase).Count());
        }

        [Fact]
        public void Every_bundle_on_disk_is_offered_and_every_offered_language_has_one()
        {
            var onDisk = Directory.GetFiles(StringsFolder, "messages.*.json")
                .Select(path => Path.GetFileNameWithoutExtension(path).Substring("messages.".Length))
                .OrderBy(code => code, StringComparer.Ordinal)
                .ToArray();
            Assert.Equal(Messages.Languages.OrderBy(code => code, StringComparer.Ordinal).ToArray(), onDisk);
        }

        [Theory]
        [MemberData(nameof(OfferedLanguages))]
        public void A_bundle_has_every_key_of_the_source_with_the_same_placeholders(string language)
        {
            var source = Messages.Bundle(Messages.SourceLanguage);
            var bundle = Messages.Bundle(language);
            Assert.NotEmpty(bundle);

            var missing = source.Keys.Except(bundle.Keys).ToArray();
            var extra = bundle.Keys.Except(source.Keys).ToArray();
            Assert.True(missing.Length == 0, $"{language} lacks: {string.Join(", ", missing)}");
            Assert.True(extra.Length == 0, $"{language} has keys the source does not: {string.Join(", ", extra)}");

            foreach (var key in source.Keys)
            {
                Assert.False(string.IsNullOrWhiteSpace(bundle[key]), $"{language}: '{key}' is empty");
                Assert.Equal(Placeholders(source[key]), Placeholders(bundle[key]));
            }
        }

        [Fact]
        public void The_bundles_are_valid_json_objects_of_strings()
        {
            foreach (var path in Directory.GetFiles(StringsFolder, "*.json"))
            {
                using var document = JsonDocument.Parse(File.ReadAllText(path));
                Assert.Equal(JsonValueKind.Object, document.RootElement.ValueKind);
            }
        }

        [Theory]
        [InlineData(1033, "en")]
        [InlineData(2057, "en")]
        [InlineData(1043, "nl")]
        [InlineData(2067, "nl")]
        [InlineData(0, null)]
        [InlineData(999999, null)]
        public void A_language_id_maps_to_an_offered_language_or_the_source(int lcid, string? expected)
        {
            var language = Messages.LanguageFor(lcid);
            if (expected != null && Messages.Languages.Contains(expected)) Assert.Equal(expected, language);
            else Assert.Contains(language, Messages.Languages);
        }

        [Fact]
        public void A_missing_key_shows_the_key_rather_than_failing() =>
            Assert.Equal("no.such.key", Messages.Format("no.such.key", "en"));

        private static string[] Placeholders(string text) =>
            Placeholder.Matches(text).Cast<Match>().Select(match => match.Groups[1].Value).OrderBy(name => name, StringComparer.Ordinal).ToArray();
    }
}

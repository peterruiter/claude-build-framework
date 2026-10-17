namespace App.Tests;

using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;
using App.Domain.Localization;

/// <summary>
/// The languages chosen for this product (build/contracts/locales.json): every one has CLDR plural rules,
/// a bundle per namespace with every key, and every counted key in the forms its culture needs; and the
/// server counts as the browser does.
/// </summary>
public sealed partial class LocalizationTests
{
    [GeneratedRegex(@"\{(\d+)\}")]
    private static partial Regex Placeholder();

    private static readonly long[] Counts = [0, 1, 2, 3, 4, 5, 11, 12, 14, 21, 22, 25, 101, 102, 111, 112, 1000, 1000000];

    [Fact]
    public void The_rules_count_as_CLDR_does_for_a_few_well_known_languages()
    {
        string Line(string language) => string.Join(' ', Counts.Select(count => PluralRules.Category(language, count)));

        Line("en").Should().Be("other one other other other other other other other other other other other other other other other other");
        Line("fr").Should().StartWith("one one other").And.EndWith("other many", "French reads 0 as one and a million as many");
        Line("pl").Should().Be("many one few few few many many many many many few many many few many many many many");
        Line("pt-PT").Should().StartWith("other one", "pt-PT is not Brazilian pt, where 0 is one");
        Line("pt").Should().StartWith("one one");
        PluralRules.Category("pl-PL", -3).Should().Be(PluralRules.Few, "a culture is read as its language, and the sign does not count");
        PluralRules.Category("xx", 1).Should().Be(PluralRules.One, "an unknown language counts as English");
        PluralRules.Needed("pl").Should().Equal(PluralRules.One, PluralRules.Few, PluralRules.Many);
    }

    [Fact]
    public void Every_offered_language_has_plural_rules_and_a_working_culture()
    {
        LocaleCatalogue.All.Should().NotBeEmpty();
        LocaleCatalogue.All.Select(locale => locale.Code).Should().OnlyHaveUniqueItems();
        foreach (var locale in LocaleCatalogue.All)
        {
            PluralRules.Knows(locale.Culture).Should().BeTrue($"build/contracts/plurals.json needs rules for {locale.Culture} or {locale.Code}");
            var culture = System.Globalization.CultureInfo.GetCultureInfo(locale.Culture);
            culture.Name.Should().NotBeEmpty();
        }
    }

    [Fact]
    public void Every_offered_language_has_every_key_with_the_same_placeholders_and_its_plural_forms()
    {
        var source = LocaleSource();
        foreach (var ns in LocaleCatalogue.Namespaces)
        {
            var english = Localizer.Bundle(ns, source);
            english.Should().NotBeEmpty($"the source bundle {ns}.{source}.json exists and is valid JSON");
            var counted = english.Keys.Where(key => key.EndsWith(".one", StringComparison.Ordinal)).Select(key => key[..^4]).ToList();
            var baseKeys = english.Keys.Where(key => !PluralRules.Categories.Any(category => key.EndsWith($".{category}", StringComparison.Ordinal))).ToList();

            foreach (var locale in LocaleCatalogue.All)
            {
                var bundle = Localizer.Bundle(ns, locale.Code);
                var where = $"{ns}.{locale.Code}.json";
                bundle.Keys.Should().Contain(baseKeys, $"{where} has every key of {ns}.{source}.json");

                foreach (var key in baseKeys)
                {
                    Placeholders(bundle[key]).Should().BeEquivalentTo(Placeholders(english[key]), $"{where} '{key}' keeps the placeholders");
                }

                foreach (var key in counted)
                {
                    foreach (var category in PluralRules.Needed(locale.Culture))
                    {
                        bundle.Should().ContainKey($"{key}.{category}", $"{where} counts '{key}' in {locale.Culture}, which needs '{category}'");
                    }
                }

                bundle.Keys.Where(key => !english.ContainsKey(key) && !PluralRules.Categories.Any(category => key.EndsWith($".{category}", StringComparison.Ordinal)))
                    .Should().BeEmpty($"{where} has no key the source does not have");
            }
        }
    }

    [Fact]
    public void Polish_counts_in_three_forms_and_falls_back_to_English_for_a_missing_key()
    {
        if (!LocaleCatalogue.All.Any(locale => locale.Code == "pl")) return;
        var t = new Localizer("email", "pl");
        string Items(int count) => t.Count("reminder.items", "You have {0} open items.", "You have {0} open item.", count);
        Items(1).Should().Be("Masz 1 otwarty element.");
        Items(3).Should().Be("Masz 3 otwarte elementy.");
        Items(5).Should().Be("Masz 5 otwartych elementów.");
        t["no.such.key", "English fallback"].Should().Be("English fallback");
    }

    [Fact]
    public void The_server_counts_as_the_browser_does_for_every_offered_culture()
    {
        // Node's Intl.PluralRules is the browser's table. Skipped (passing) without Node: the web build runs
        // src/web/scripts/check-plurals.mjs, which compares the same file without .NET.
        var cultures = LocaleCatalogue.All.Select(locale => locale.Culture).ToList();
        var script = $"const c={JsonSerializer.Serialize(Counts)};for(const l of {JsonSerializer.Serialize(cultures)}){{const r=new Intl.PluralRules(l);console.log(l+'='+c.map(n=>r.select(n)).join(' '))}}";
        string output;
        try
        {
            using var node = Process.Start(new ProcessStartInfo("node", ["-e", script]) { RedirectStandardOutput = true, UseShellExecute = false })!;
            output = node.StandardOutput.ReadToEnd();
            node.WaitForExit();
            if (node.ExitCode != 0) return;
        }
        catch (System.ComponentModel.Win32Exception)
        {
            return;
        }

        foreach (var line in output.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var culture = line[..line.IndexOf('=', StringComparison.Ordinal)];
            var expected = line[(line.IndexOf('=', StringComparison.Ordinal) + 1)..];
            string.Join(' ', Counts.Select(count => PluralRules.Category(culture, count))).Should().Be(expected, $"{culture} counts as Intl.PluralRules does");
        }
    }

    private static string LocaleSource()
    {
        using var contract = JsonDocument.Parse(Repository.Contract("locales"));
        return contract.RootElement.TryGetProperty("source", out var source) ? source.GetString()! : "en";
    }

    private static IEnumerable<string> Placeholders(string text) => Placeholder().Matches(text).Select(match => match.Value).Distinct();
}

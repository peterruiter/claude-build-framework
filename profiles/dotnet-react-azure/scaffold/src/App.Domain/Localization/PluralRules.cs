namespace App.Domain.Localization;

using System.Collections.Concurrent;
using System.Globalization;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;

/// <summary>
/// The CLDR plural category of a whole number, for whichever languages the project offers: what the
/// browser's <c>Intl.PluralRules</c> answers for the same culture, so an email and the screen agree.
/// </summary>
/// <remarks>
/// <para>
/// .NET carries CLDR data inside ICU but has no managed API for plural rules, so the rules are data:
/// build/contracts/plurals.json holds CLDR's cardinal rules (Unicode's plurals.xml, in the syntax of
/// cldr-json) for many languages, and this class evaluates them. Adding a language to the project
/// needs no code, only its entry there (most languages already have one).
/// </para>
/// <para>
/// Counts are whole numbers, so only integer operands are evaluated: n and i are the count, and v, w,
/// f, t, c and e are 0. PluralRulesTests compares every configured culture against Node's
/// <c>Intl.PluralRules</c> when Node is installed, which is how a mistake in the data is found.
/// </para>
/// <para>Rules are looked up by culture (pt-PT), then by language (pt); an unknown language counts as English.</para>
/// </remarks>
public static partial class PluralRules
{
    /// <summary>Zero (Arabic, Welsh, Latvian).</summary>
    public const string Zero = "zero";

    /// <summary>One: "1 item".</summary>
    public const string One = "one";

    /// <summary>Two (Arabic, Hebrew, Slovenian, Welsh, Irish).</summary>
    public const string Two = "two";

    /// <summary>Few: Polish 2-4, 22-24.</summary>
    public const string Few = "few";

    /// <summary>Many: Polish 5-21; a million in French, Spanish, Italian, Portuguese.</summary>
    public const string Many = "many";

    /// <summary>Other: the key itself, and the fallback for every category.</summary>
    public const string Other = "other";

    /// <summary>The categories in the order they are tried; the first that matches wins.</summary>
    public static readonly IReadOnlyList<string> Categories = [Zero, One, Two, Few, Many];

    private static readonly Lazy<Dictionary<string, IReadOnlyDictionary<string, string>>> Data = new(Load);
    private static readonly ConcurrentDictionary<string, IReadOnlyList<(string Category, Func<long, bool> Test)>> Compiled = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Whether plurals.json has rules for a culture or its language.</summary>
    /// <param name="cultureOrLanguage">pt-PT, pt, en and so on.</param>
    public static bool Knows(string cultureOrLanguage)
    {
        ArgumentNullException.ThrowIfNull(cultureOrLanguage);
        return Find(cultureOrLanguage) is not null;
    }

    /// <summary>The category of a count in a culture or language.</summary>
    /// <param name="cultureOrLanguage">A culture such as pl-PL, or a language code such as pl.</param>
    /// <param name="count">The count; its sign is ignored.</param>
    public static string Category(string? cultureOrLanguage, long count)
    {
        var n = count == long.MinValue ? long.MaxValue : Math.Abs(count);
        foreach (var (category, test) in Rules(cultureOrLanguage ?? "en"))
        {
            if (test(n)) return category;
        }

        return Other;
    }

    /// <summary>
    /// The categories besides <see cref="Other"/> that counts from 0 to 200 fall into in a language:
    /// the forms every counted string needs in that language (one; or one, few and many, and so on).
    /// </summary>
    /// <param name="cultureOrLanguage">A culture or language code.</param>
    public static IReadOnlyList<string> Needed(string? cultureOrLanguage)
    {
        var found = Enumerable.Range(0, 201).Select(count => Category(cultureOrLanguage, count)).ToHashSet(StringComparer.Ordinal);
        return [.. Categories.Where(found.Contains)];
    }

    private static IReadOnlyList<(string Category, Func<long, bool> Test)> Rules(string cultureOrLanguage) =>
        Compiled.GetOrAdd(cultureOrLanguage.Trim(), key =>
        {
            var rules = Find(key) ?? Find("en") ?? new Dictionary<string, string>();
            return [.. Categories.Where(rules.ContainsKey).Select(category => (category, Compile(rules[category])))];
        });

    private static IReadOnlyDictionary<string, string>? Find(string cultureOrLanguage)
    {
        var key = cultureOrLanguage.Trim().Replace('_', '-');
        if (Data.Value.TryGetValue(key, out var exact)) return exact;
        var dash = key.IndexOf('-', StringComparison.Ordinal);
        return dash > 0 && Data.Value.TryGetValue(key[..dash], out var language) ? language : null;
    }

    // ------------------------------------------------------------- the rule syntax --
    // condition     = and_condition ('or' and_condition)*
    // and_condition = relation ('and' relation)*
    // relation      = operand ('%' value)? ('=' | '!=') range_list
    // range_list    = (value | value'..'value) (',' range_list)*
    // CLDR rules have no parentheses, so splitting on the words is exact. Samples (@integer ...) are ignored.

    [GeneratedRegex(@"^\s*(?<operand>[niftvwce])\s*(?:%\s*(?<mod>\d+))?\s*(?<op>!=|=)\s*(?<ranges>[\d\s.,]+)$")]
    private static partial Regex Relation();

    /// <summary>Compiles one CLDR condition for integer counts.</summary>
    /// <param name="condition">Such as <c>v = 0 and i % 10 = 2..4 and i % 100 != 12..14</c>.</param>
    internal static Func<long, bool> Compile(string condition)
    {
        var text = condition.Split('@')[0].Trim();
        if (text.Length == 0) return _ => true;

        var alternatives = text.Split(" or ", StringSplitOptions.TrimEntries)
            .Select(alternative => alternative.Split(" and ", StringSplitOptions.TrimEntries).Select(CompileRelation).ToArray())
            .ToArray();

        return n => alternatives.Any(relations => relations.All(relation => relation(n)));
    }

    private static Func<long, bool> CompileRelation(string relation)
    {
        var match = Relation().Match(relation);
        if (!match.Success) throw new FormatException($"Not a CLDR plural relation: '{relation}'.");

        var integerOperand = match.Groups["operand"].Value is "n" or "i";
        long? modulus = match.Groups["mod"].Success ? long.Parse(match.Groups["mod"].Value, CultureInfo.InvariantCulture) : null;
        var negate = match.Groups["op"].Value == "!=";
        var ranges = match.Groups["ranges"].Value.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .Select(range =>
            {
                var parts = range.Split("..", StringSplitOptions.TrimEntries);
                var low = long.Parse(parts[0], CultureInfo.InvariantCulture);
                return (Low: low, High: parts.Length > 1 ? long.Parse(parts[1], CultureInfo.InvariantCulture) : low);
            })
            .ToArray();

        return n =>
        {
            // For a whole number, v, w, f, t, c and e are all 0.
            var value = integerOperand ? n : 0;
            if (modulus is { } m) value %= m;
            var inside = ranges.Any(range => value >= range.Low && value <= range.High);
            return inside != negate;
        };
    }

    private sealed record PluralData(Dictionary<string, Dictionary<string, string>> Rules);

    private static Dictionary<string, IReadOnlyDictionary<string, string>> Load()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("App.Domain.Contracts.plurals.json")
            ?? throw new InvalidOperationException("build/contracts/plurals.json is not embedded in this build.");
        var data = JsonSerializer.Deserialize<PluralData>(stream, JsonOptions.Contracts)
            ?? throw new InvalidOperationException("build/contracts/plurals.json could not be read.");

        return data.Rules.ToDictionary(
            pair => pair.Key,
            pair => (IReadOnlyDictionary<string, string>)pair.Value
                .Where(rule => Categories.Contains(rule.Key))
                .ToDictionary(rule => rule.Key, rule => rule.Value, StringComparer.Ordinal),
            StringComparer.OrdinalIgnoreCase);
    }
}

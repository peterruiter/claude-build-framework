namespace App.Domain.Localization;

using System.Reflection;
using System.Text.Json;

/// <summary>One language the product is offered in.</summary>
/// <param name="Code">The language code, such as en or nl. Bundles are named after it.</param>
/// <param name="Culture">The culture numbers, dates and plural rules use, such as en-GB or pt-PT.</param>
/// <param name="EnglishName">What an English reader calls it.</param>
/// <param name="NativeName">What its own readers call it, which is what a language picker shows.</param>
public sealed record Locale(string Code, string Culture, string EnglishName, string NativeName);

/// <summary>
/// The languages, from build/contracts/locales.json: chosen per project when it is scaffolded
/// (scaffold.ps1 -Languages) and extended later with src/web/scripts/add-language.mjs.
/// </summary>
/// <remarks>
/// The same file the web apps compile in for their picker, so the server cannot accept a language
/// the screen does not offer, or the other way round.
/// </remarks>
public static class LocaleCatalogue
{
    private static readonly Lazy<Contract> Loaded = new(Load);

    /// <summary>Every offered language, in picker order (alphabetical by native name).</summary>
    public static IReadOnlyList<Locale> All => Loaded.Value.Locales;

    /// <summary>The fallback language, whose bundles must be complete.</summary>
    public static Locale Default => All.First(locale => locale.Code == Loaded.Value.Default);

    /// <summary>The string bundle namespaces, such as ui and email.</summary>
    public static IReadOnlyList<string> Namespaces => Loaded.Value.Namespaces;

    /// <summary>A language by code or culture, or the default when it is unknown or absent.</summary>
    /// <param name="code">A code (nl) or a culture (nl-BE), in any case.</param>
    public static Locale Resolve(string? code)
    {
        var wanted = code?.Trim() ?? string.Empty;
        return All.FirstOrDefault(locale => string.Equals(locale.Code, wanted, StringComparison.OrdinalIgnoreCase))
            ?? All.FirstOrDefault(locale => string.Equals(locale.Culture, wanted, StringComparison.OrdinalIgnoreCase))
            ?? All.FirstOrDefault(locale => wanted.Contains('-', StringComparison.Ordinal)
                && string.Equals(locale.Code, wanted[..wanted.IndexOf('-', StringComparison.Ordinal)], StringComparison.OrdinalIgnoreCase))
            ?? Default;
    }

    private sealed record Contract(string Default, List<Locale> Locales, List<string> Namespaces);

    private static Contract Load()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("App.Domain.Contracts.locales.json")
            ?? throw new InvalidOperationException("build/contracts/locales.json is not embedded in this build.");

        var contract = JsonSerializer.Deserialize<Contract>(stream, JsonOptions.Contracts)
            ?? throw new InvalidOperationException("build/contracts/locales.json could not be read.");

        if (contract.Locales.Count == 0) throw new InvalidOperationException("build/contracts/locales.json offers no language.");
        if (!contract.Locales.Exists(locale => locale.Code == contract.Default))
        {
            throw new InvalidOperationException($"build/contracts/locales.json names '{contract.Default}' as the default but does not offer it.");
        }

        return contract;
    }
}

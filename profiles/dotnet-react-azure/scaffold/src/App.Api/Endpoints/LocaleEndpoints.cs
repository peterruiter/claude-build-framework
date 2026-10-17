namespace App.Api.Endpoints;

using App.Domain.Localization;

/// <summary>The offered languages and their bundles, for clients that do not compile them in.</summary>
public static class LocaleEndpoints
{
    /// <summary>Maps /api/locales and /api/strings/{ns}/{language}.</summary>
    /// <param name="app">The routes.</param>
    public static IEndpointRouteBuilder MapLocaleEndpoints(this IEndpointRouteBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);

        app.MapGet("/api/locales", () => Results.Ok(new
        {
            @default = LocaleCatalogue.Default.Code,
            locales = LocaleCatalogue.All,
        }));

        app.MapGet("/api/strings/{ns}/{language}", (string ns, string language) =>
        {
            if (!LocaleCatalogue.Namespaces.Contains(ns, StringComparer.Ordinal)) return Results.NotFound();
            var locale = LocaleCatalogue.Resolve(language);
            return Results.Ok(Localizer.Bundle(ns, locale.Code));
        });

        return app;
    }
}

namespace App.Api.Endpoints;

using App.Data;

/// <summary>The sample API: replace with your own. Every route is listed in build/contracts/routes.json.</summary>
public static class ItemEndpoints
{
    /// <summary>A new item.</summary>
    /// <param name="Name">Its name.</param>
    /// <param name="Tag">A tag name, or null.</param>
    public sealed record NewItem(string? Name, string? Tag);

    /// <summary>Maps /api/items.</summary>
    /// <param name="app">The routes.</param>
    public static IEndpointRouteBuilder MapItemEndpoints(this IEndpointRouteBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);

        // Reads the database: what the availability test calls to know the app and its database answer together.
        app.MapGet("/api/items", async (ItemStore store, int? take, CancellationToken cancellationToken) =>
            Results.Ok(await store.RecentAsync(take ?? 20, cancellationToken)));

        // Ten a minute per address, counted once for every replica.
        app.MapPost("/api/items", async (NewItem item, ItemStore store, CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(item.Name) || item.Name.Length > 200)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = ["A name of 1 to 200 characters."] });
            }

            var stored = await store.AddAsync(item.Name.Trim(), ownerId: null, item.Tag?.Trim(), cancellationToken);
            return Results.Created($"/api/items/{stored.ItemId}", stored);
        }).AddEndpointFilter(new RateLimitFilter("items-create", 10, TimeSpan.FromMinutes(1)));

        return app;
    }
}

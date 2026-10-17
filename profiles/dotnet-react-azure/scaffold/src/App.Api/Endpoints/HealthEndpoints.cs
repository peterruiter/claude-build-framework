namespace App.Api.Endpoints;

/// <summary>The probes the platform calls.</summary>
/// <remarks>
/// Neither touches the database, on purpose: a slow or paused database is not a reason to restart a healthy
/// container, and a probe that restarts what it measures turns a slow dependency into an outage. Whether the
/// app and its database answer together is the availability tests' job (infra/modules/alerts.bicep), which
/// call an endpoint that does read the database.
/// </remarks>
public static class HealthEndpoints
{
    /// <summary>Maps /health/live and /health/ready.</summary>
    /// <param name="app">The routes.</param>
    public static IEndpointRouteBuilder MapHealthEndpoints(this IEndpointRouteBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        app.MapGet("/health/live", () => Results.Text("live")).ExcludeFromDescription();
        app.MapGet("/health/ready", () => Results.Text("ready")).ExcludeFromDescription();
        return app;
    }
}

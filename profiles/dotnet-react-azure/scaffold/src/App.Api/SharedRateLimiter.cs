namespace App.Api;

using System.Collections.Concurrent;
using System.Globalization;
using App.Data;
using Microsoft.Data.SqlClient;

/// <summary>
/// Fixed-window rate limits counted once for every replica, in the database (<see cref="RateCounterStore"/>).
/// </summary>
/// <remarks>
/// <para>
/// ASP.NET's own limiter counts per process: with three replicas a limit is three limits. This one asks the
/// database, so a limit holds however far the app scales.
/// </para>
/// <para>
/// When the database does not answer, the call is counted in memory for that moment and a warning is
/// logged at most once a minute: a limit that fails shut turns a database blip into a site that refuses
/// everybody.
/// </para>
/// </remarks>
/// <param name="store">The shared counters.</param>
/// <param name="logger">Where a database that does not answer is mentioned.</param>
public sealed class SharedRateLimiter(RateCounterStore store, ILogger<SharedRateLimiter> logger)
{
    private readonly ConcurrentDictionary<string, (DateTime Until, int Hits)> fallback = new(StringComparer.Ordinal);
    private long lastWarning;

    /// <summary>Counts a call and says whether it may go ahead, with seconds until the window resets.</summary>
    /// <param name="partition">The limit's name and its key, such as <c>items:203.0.113.7</c>.</param>
    /// <param name="limit">Calls a window.</param>
    /// <param name="window">The window.</param>
    /// <param name="cancellationToken">Cancellation.</param>
    public async Task<(bool Allowed, int RetryAfterSeconds)> TakeAsync(string partition, int limit, TimeSpan window, CancellationToken cancellationToken)
    {
        try
        {
            var count = await store.TakeAsync(partition, limit, window, cancellationToken);
            return (count.Allowed, Math.Max(1, (int)Math.Ceiling((count.UntilUtc - DateTime.UtcNow).TotalSeconds)));
        }
        catch (Exception failure) when (failure is SqlException or InvalidOperationException or TimeoutException)
        {
            var now = Environment.TickCount64;
            if (now - Interlocked.Read(ref lastWarning) > 60_000)
            {
                Interlocked.Exchange(ref lastWarning, now);
                logger.LogWarning("Shared rate limits could not reach the database; counting on this replica. {Reason}", Redact.Exception(failure));
            }

            var utcNow = DateTime.UtcNow;
            var entry = fallback.AddOrUpdate(partition, _ => (utcNow + window, 1), (_, old) => old.Until > utcNow ? (old.Until, old.Hits + 1) : (utcNow + window, 1));
            return (entry.Hits <= limit, Math.Max(1, (int)Math.Ceiling((entry.Until - utcNow).TotalSeconds)));
        }
    }
}

/// <summary>An endpoint filter that applies a shared limit per client address.</summary>
/// <param name="name">The limit's name, which keeps its partitions apart from other limits'.</param>
/// <param name="limit">Calls a window.</param>
/// <param name="window">The window.</param>
public sealed class RateLimitFilter(string name, int limit, TimeSpan window) : IEndpointFilter
{
    /// <inheritdoc />
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);
        var http = context.HttpContext;
        var limiter = http.RequestServices.GetRequiredService<SharedRateLimiter>();
        // The address the ingress saw (ForwardedHeaders reads the entry the ingress appended).
        var key = http.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        var (allowed, retryAfter) = await limiter.TakeAsync($"{name}:{key}", limit, window, http.RequestAborted);
        if (allowed) return await next(context);

        http.Response.Headers.RetryAfter = retryAfter.ToString(CultureInfo.InvariantCulture);
        return Results.Problem(statusCode: StatusCodes.Status429TooManyRequests, title: "Too many requests. Try again shortly.");
    }
}

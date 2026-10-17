namespace App.Api;

using System.Text.RegularExpressions;

/// <summary>
/// What may go into a log line about a person or an address: nothing that identifies them.
/// </summary>
/// <remarks>
/// Logs leave the product's control (Log Analytics, exports, support tickets) and are kept for weeks, so
/// they carry why something failed and never who it failed for. URLs are cut to scheme and host (a query
/// string carries tokens, a path carries ids and email addresses), email addresses to their domain, and an
/// exception to its type and a redacted message.
/// </remarks>
public static partial class Redact
{
    [GeneratedRegex(@"[A-Za-z0-9._%+\-]+@(?<domain>[A-Za-z0-9.\-]+\.[A-Za-z]{2,})")]
    private static partial Regex EmailPattern();

    [GeneratedRegex(@"(?<scheme>https?)://(?<host>[^/\s?#]+)[^\s""']*")]
    private static partial Regex UrlPattern();

    /// <summary>A URL as scheme and host only: https://api.example.com/users/42?token=x becomes https://api.example.com.</summary>
    /// <param name="url">The URL, or null.</param>
    public static string Url(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return string.Empty;
        return Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.IsAbsoluteUri
            ? $"{uri.Scheme}://{uri.Host}{(uri.IsDefaultPort ? string.Empty : $":{uri.Port}")}"
            : "(relative url)";
    }

    /// <summary>An email address as its domain only: person@example.com becomes ***@example.com.</summary>
    /// <param name="email">The address, or null.</param>
    public static string Email(string? email)
    {
        if (string.IsNullOrWhiteSpace(email)) return string.Empty;
        var at = email.LastIndexOf('@');
        return at < 0 ? "***" : $"***{email[at..]}";
    }

    /// <summary>Free text with every URL and email address in it redacted.</summary>
    /// <param name="text">The text, such as an exception message from an HTTP client.</param>
    public static string Text(string? text)
    {
        if (string.IsNullOrEmpty(text)) return string.Empty;
        var withoutUrls = UrlPattern().Replace(text, match => $"{match.Groups["scheme"].Value}://{match.Groups["host"].Value}");
        return EmailPattern().Replace(withoutUrls, match => $"***@{match.Groups["domain"].Value}");
    }

    /// <summary>An exception as its type and redacted message, without the stack's data.</summary>
    /// <param name="exception">The exception.</param>
    public static string Exception(Exception exception)
    {
        ArgumentNullException.ThrowIfNull(exception);
        return $"{exception.GetType().Name}: {Text(exception.Message)}";
    }
}

/// <summary>Logs server errors with the route, never the full URL or the query string.</summary>
/// <param name="next">The rest of the pipeline.</param>
/// <param name="logger">The log.</param>
public sealed class RequestFailureLogging(RequestDelegate next, ILogger<RequestFailureLogging> logger)
{
    /// <summary>Runs the request and logs a 5xx.</summary>
    /// <param name="context">The request.</param>
    public async Task InvokeAsync(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        await next(context);
        if (context.Response.StatusCode >= 500)
        {
            // The endpoint's route pattern (/api/items/{id}), not the path with the id in it.
            var route = (context.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText ?? "(no route)";
            logger.LogError("{Method} {Route} answered {Status}.", context.Request.Method, route, context.Response.StatusCode);
        }
    }
}

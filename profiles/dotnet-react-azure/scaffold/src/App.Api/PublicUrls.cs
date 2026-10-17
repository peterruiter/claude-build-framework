namespace App.Api;

/// <summary>
/// The addresses that leave the product: in emails, calendar files, QR codes, OAuth metadata.
/// </summary>
/// <remarks>
/// <para>
/// The configured public address (Site:PublicBaseUrl) when there is one, the request's own otherwise. A link
/// in an email outlives the request that wrote it by months, so it names the address the product means to
/// keep, not whichever host name the container happened to be reached on.
/// </para>
/// <para>
/// Never remember a request's host in a static for later use: the next background job would write
/// whatever host the last caller sent (a client controls the Host header). Work done without a request
/// uses <see cref="Origin(string)"/> with an explicit fallback.
/// </para>
/// </remarks>
/// <param name="configured">Site:PublicBaseUrl, if set.</param>
public sealed class PublicUrls(string? configured)
{
    private readonly Uri? canonical = Uri.TryCreate(configured, UriKind.Absolute, out var uri) ? uri : null;

    /// <summary>Whether a public address is configured. What must not be shaped by a client asks this first.</summary>
    public bool IsConfigured => canonical is not null;

    /// <summary>The origin for a request, without a trailing slash.</summary>
    /// <param name="request">The request, used only when nothing is configured.</param>
    public string Origin(HttpRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        return canonical?.GetLeftPart(UriPartial.Authority) ?? $"{request.Scheme}://{request.Host}";
    }

    /// <summary>The origin for work done without a request.</summary>
    /// <param name="fallback">What to use when nothing is configured, such as the origin stored with the job.</param>
    public string Origin(string fallback)
    {
        ArgumentNullException.ThrowIfNull(fallback);
        return canonical?.GetLeftPart(UriPartial.Authority) ?? fallback.TrimEnd('/');
    }

    /// <summary>An absolute link on this product.</summary>
    /// <param name="origin">The origin, from <see cref="Origin(HttpRequest)"/>.</param>
    /// <param name="path">A path starting with '/'.</param>
    public static string Link(string origin, string path)
    {
        ArgumentNullException.ThrowIfNull(origin);
        ArgumentNullException.ThrowIfNull(path);
        return path.StartsWith('/') ? $"{origin.TrimEnd('/')}{path}" : throw new ArgumentException("A path starts with '/'.", nameof(path));
    }
}

/// <summary>Sends the platform's own host name and www to the public address, once one is configured.</summary>
public static class CanonicalHost
{
    /// <summary>
    /// Redirects every host but the public one, except health probes (answered wherever they arrive).
    /// 302/307 from the platform host, because that is a setting a browser must not remember for good;
    /// 301/308 from www. The method is kept for anything but GET/HEAD, so a form post is not lost.
    /// </summary>
    /// <param name="app">The app.</param>
    /// <param name="publicBaseUrl">Site:PublicBaseUrl, or null to leave every host alone.</param>
    public static IApplicationBuilder UseCanonicalHost(this IApplicationBuilder app, string? publicBaseUrl)
    {
        ArgumentNullException.ThrowIfNull(app);
        if (!Uri.TryCreate(publicBaseUrl, UriKind.Absolute, out var canonical)) return app;

        return app.Use(async (context, next) =>
        {
            var host = context.Request.Host.Host;
            var www = string.Equals(host, $"www.{canonical.Host}", StringComparison.OrdinalIgnoreCase);
            var platform = host.EndsWith(".azurecontainerapps.io", StringComparison.OrdinalIgnoreCase);
            if (string.Equals(host, canonical.Host, StringComparison.OrdinalIgnoreCase)
                || context.Request.Path.StartsWithSegments("/health", StringComparison.OrdinalIgnoreCase)
                || (!www && !platform))
            {
                await next();
                return;
            }

            var page = HttpMethods.IsGet(context.Request.Method) || HttpMethods.IsHead(context.Request.Method);
            context.Response.StatusCode = (www, page) switch
            {
                (true, true) => StatusCodes.Status301MovedPermanently,
                (true, false) => StatusCodes.Status308PermanentRedirect,
                (false, true) => StatusCodes.Status302Found,
                (false, false) => StatusCodes.Status307TemporaryRedirect,
            };
            context.Response.Headers.Location = $"{canonical.GetLeftPart(UriPartial.Authority)}{context.Request.PathBase}{context.Request.Path}{context.Request.QueryString}";
        });
    }
}

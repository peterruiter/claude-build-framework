namespace App.Tests;

using System.Net;
using System.Text.Json;
using App.Api;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

/// <summary>
/// The API's shape: the probes, one public address, and the routes contract (build/contracts/routes.json),
/// which is the template for every contract test: a registry several surfaces share, held to the code.
/// </summary>
public sealed class ApiTests
{
    [Fact]
    public async Task The_probes_answer_without_a_database()
    {
        using var api = new ApiFactory();
        using var client = api.CreateClient();

        (await client.GetAsync(new Uri("/health/live", UriKind.Relative))).StatusCode.Should().Be(HttpStatusCode.OK);
        (await client.GetAsync(new Uri("/health/ready", UriKind.Relative))).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task With_a_public_address_the_platform_host_redirects_there_but_probes_do_not()
    {
        using var api = new ApiFactory(publicBaseUrl: "https://www.example.com");
        using var client = api.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false, BaseAddress = new Uri("https://myapp.blue-sky-123.westeurope.azurecontainerapps.io") });

        var page = await client.GetAsync(new Uri("/app/items?x=1", UriKind.Relative));
        page.StatusCode.Should().Be(HttpStatusCode.Found, "temporary: the redirect is a setting a browser must not remember");
        page.Headers.Location.Should().Be(new Uri("https://www.example.com/app/items?x=1"));

        (await client.GetAsync(new Uri("/health/ready", UriKind.Relative))).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public void Public_links_use_the_configured_address_not_the_callers_host()
    {
        var urls = new PublicUrls("https://www.example.com/");
        var request = new DefaultHttpContext().Request;
        request.Scheme = "https";
        request.Host = new HostString("attacker.example.net");

        urls.Origin(request).Should().Be("https://www.example.com");
        PublicUrls.Link(urls.Origin(request), "/app/").Should().Be("https://www.example.com/app/");
        new PublicUrls(null).Origin("https://fallback.example.com/").Should().Be("https://fallback.example.com");
    }

    [Fact]
    public void Every_route_is_in_the_routes_contract_and_every_contract_route_exists()
    {
        using var api = new ApiFactory();
        var mapped = api.Services.GetRequiredService<EndpointDataSource>().Endpoints
            .OfType<RouteEndpoint>()
            .SelectMany(endpoint => (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods ?? []).Select(method => $"{method} /{endpoint.RoutePattern.RawText!.TrimStart('/')}"))
            // The web apps' client-side fallbacks are files, not API.
            .Where(route => !route.Contains("{*path", StringComparison.Ordinal))
            .ToHashSet(StringComparer.Ordinal);

        using var contract = JsonDocument.Parse(Repository.Contract("routes"));
        var declared = contract.RootElement.GetProperty("routes").EnumerateArray().Select(route => route.GetProperty("route").GetString()!).ToHashSet(StringComparer.Ordinal);

        mapped.Except(declared).Should().BeEmpty("a new route is added to build/contracts/routes.json with who may call it");
        declared.Except(mapped).Should().BeEmpty("a route in the contract exists in the code");
        contract.RootElement.GetProperty("routes").EnumerateArray()
            .Select(route => route.TryGetProperty("access", out var access) ? access.GetString() : null)
            .Should().OnlyContain(access => access == "public" || access == "signed-in" || access == "admin" || access == "probe", "every route says who may call it");
    }

    [Fact]
    public async Task The_language_list_and_bundles_are_served()
    {
        using var api = new ApiFactory();
        using var client = api.CreateClient();

        var locales = await client.GetStringAsync(new Uri("/api/locales", UriKind.Relative));
        locales.Should().Contain("\"default\"");
        (await client.GetAsync(new Uri("/api/strings/ui/en", UriKind.Relative))).StatusCode.Should().Be(HttpStatusCode.OK);
        (await client.GetAsync(new Uri("/api/strings/nope/en", UriKind.Relative))).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}

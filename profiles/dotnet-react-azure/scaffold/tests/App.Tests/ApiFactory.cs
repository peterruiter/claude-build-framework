namespace App.Tests;

using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

/// <summary>
/// The API in memory, configured for tests: a connection string (a scratch database's, or one nothing
/// answers on for tests that never touch the database), no schema check on start, and an optional public
/// address.
/// </summary>
/// <param name="connectionString">The database; the default points at nothing.</param>
/// <param name="publicBaseUrl">Site:PublicBaseUrl, or null.</param>
public sealed class ApiFactory(string? connectionString = null, string? publicBaseUrl = null) : WebApplicationFactory<Program>
{
    /// <summary>A connection string nothing answers on: for tests that must not reach a database.</summary>
    public const string NoDatabase = "Server=tcp:127.0.0.1,1;Database=none;Connect Timeout=1;TrustServerCertificate=true";

    /// <inheritdoc />
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);
        // UseSetting reaches the configuration before Program.cs reads it, which ConfigureAppConfiguration does not.
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Database", connectionString ?? NoDatabase);
        builder.UseSetting("Database:CheckOnStart", "false");
        if (publicBaseUrl is not null) builder.UseSetting("Site:PublicBaseUrl", publicBaseUrl);
    }
}

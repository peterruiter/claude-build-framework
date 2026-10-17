using System.Text;
using App.Api;
using App.Api.Endpoints;
using App.Data;
using Microsoft.AspNetCore.HttpOverrides;

// The Linux image has no legacy code pages (Windows-1252, IBM437 ...): a CSV export or an old mail
// format that asks for one throws NotSupportedException in the container and works on a laptop.
Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

var builder = WebApplication.CreateBuilder(args);
var settings = AppSettings.Read(builder.Configuration, builder.Environment.EnvironmentName);

// ------------------------------------------------------------------ migrate --
// "dotnet App.Api.dll migrate" applies the schema and exits. build/Initialize-Database.ps1 runs it as the
// signed-in person: the deployed app's identity may read and write data but not change the schema.
if (args is ["migrate", ..])
{
    var migrated = await new DatabaseMigrator(settings.ConnectionString).ApplyAsync(Console.WriteLine, CancellationToken.None);
    Console.WriteLine($"{migrated.Count(result => result.Applied)} migration(s) applied, {migrated.Count(result => !result.Applied)} already applied.");
    return;
}

// ----------------------------------------------------------------- services --
builder.Services.AddSingleton(settings);
builder.Services.AddSingleton(new PublicUrls(settings.PublicBaseUrl));
builder.Services.AddSingleton(new ItemStore(settings.ConnectionString));
builder.Services.AddSingleton(new RateCounterStore(settings.ConnectionString));
builder.Services.AddSingleton<SharedRateLimiter>();
builder.Services.AddSingleton<IErasureParticipant>(new ItemErasure(settings.ConnectionString));
builder.Services.AddSingleton<Erasure>();
builder.Services.AddProblemDetails();
builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase);

var app = builder.Build();

// ----------------------------------------------------------------- database --
if (settings.ApplyMigrationsOnStart)
{
    // A laptop only (AppSettings refuses it elsewhere): the person running the API is the person who
    // would run the migrations.
    await LocalDatabaseBootstrap.EnsureCreatedAsync(settings.ConnectionString, CancellationToken.None);
    foreach (var result in await new DatabaseMigrator(settings.ConnectionString).ApplyAsync(null, CancellationToken.None))
    {
        if (result.Applied) app.Logger.LogInformation("Applied {Migration} in {Elapsed}.", result.Name, result.Elapsed);
    }
}
else if (settings.CheckSchemaOnStart)
{
    // Deployed: say loudly when the database is behind the code, and keep serving. Not awaited, so a
    // slow database never holds a new replica off its health probes.
    _ = Task.Run(async () =>
    {
        try
        {
            var pending = await new DatabaseMigrator(settings.ConnectionString).PendingAsync(app.Lifetime.ApplicationStopping);
            if (pending.Count > 0)
            {
                app.Logger.LogError("The database is behind this build: {Pending}. Run build/Initialize-Database.ps1.", string.Join(", ", pending));
            }
        }
        catch (Exception exception) when (exception is Microsoft.Data.SqlClient.SqlException or InvalidOperationException or OperationCanceledException)
        {
            app.Logger.LogWarning("Could not check the schema version: {Reason}", Redact.Exception(exception));
        }
    });
}

// ----------------------------------------------------------------- pipeline --
// The platform's ingress terminates TLS and forwards plain HTTP. Without this every URL the framework
// builds carries http:// and sign-in redirects are refused. Only the ingress can reach the container, so
// every proxy is trusted; ForwardLimit stays 1, so only the entry the ingress appended is read.
// X-Forwarded-Host is NOT honoured: a client could send it. What must not be shaped by a client (links
// in emails, OAuth issuers) uses PublicUrls with Site:PublicBaseUrl.
var forwarded = new ForwardedHeadersOptions { ForwardedHeaders = ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedFor };
forwarded.KnownNetworks.Clear();
forwarded.KnownProxies.Clear();
app.UseForwardedHeaders(forwarded);

app.UseExceptionHandler();
app.UseMiddleware<RequestFailureLogging>();
app.UseCanonicalHost(settings.PublicBaseUrl);

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseRouting();

app.MapHealthEndpoints();
app.MapLocaleEndpoints();
app.MapItemEndpoints();

// The two web apps: client-side routes fall back to their own index.html.
app.MapFallbackToFile("/app/{*path:nonfile}", "app/index.html");
app.MapFallbackToFile("/portal/{*path:nonfile}", "portal/index.html");

await app.RunAsync();

/// <summary>The entry point, visible to the tests' WebApplicationFactory.</summary>
public partial class Program;

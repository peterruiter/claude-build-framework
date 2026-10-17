namespace App.Api;

/// <summary>
/// Every setting the API reads, in one place, with the environment variable name the infrastructure
/// writes (infra/modules/containerapps.bicep). A setting written there under a name nothing reads here
/// is a silent failure, so the names live next to each other in both files.
/// </summary>
/// <param name="ConnectionString">ConnectionStrings__Database. Entra authentication in Azure, no password.</param>
/// <param name="PublicBaseUrl">Site__PublicBaseUrl: the address links in emails point at, once a domain is bound.</param>
/// <param name="ApplyMigrationsOnStart">Database__ApplyMigrations: Development only.</param>
/// <param name="CheckSchemaOnStart">Database__CheckOnStart: log when the database is behind (default on).</param>
public sealed record AppSettings(string ConnectionString, string? PublicBaseUrl, bool ApplyMigrationsOnStart, bool CheckSchemaOnStart)
{
    /// <summary>Reads and checks the settings.</summary>
    /// <param name="configuration">The configuration.</param>
    /// <param name="environmentName">The host's environment: Development, Production ...</param>
    public static AppSettings Read(IConfiguration configuration, string environmentName)
    {
        ArgumentNullException.ThrowIfNull(configuration);

        var connection = configuration.GetConnectionString("Database");
        if (string.IsNullOrWhiteSpace(connection))
        {
            throw new InvalidOperationException("No connection string. Set ConnectionStrings__Database (build/Start-Local.ps1 does it for LocalDB).");
        }

        var apply = string.Equals(configuration["Database:ApplyMigrations"], "true", StringComparison.OrdinalIgnoreCase);
        if (apply && !string.Equals(environmentName, "Development", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Database:ApplyMigrations is for Development only. Deployed, a person applies migrations with build/Initialize-Database.ps1.");
        }

        var check = !string.Equals(configuration["Database:CheckOnStart"], "false", StringComparison.OrdinalIgnoreCase);
        var publicBaseUrl = configuration["Site:PublicBaseUrl"];
        return new AppSettings(connection, string.IsNullOrWhiteSpace(publicBaseUrl) ? null : publicBaseUrl.Trim(), apply, check);
    }
}

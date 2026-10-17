namespace App.Tests;

using App.Data;
using Microsoft.Data.SqlClient;

/// <summary>
/// A scratch database of its own, migrated from nothing and dropped afterwards, for the rules only SQL
/// Server can hold: a lock, a unique key, a MERGE under concurrency.
/// </summary>
/// <remarks>
/// <para>
/// Where it lives: the server in the TEST_SQL_CONNECTION environment variable when it is set (CI sets it to
/// a SQL Server service container; any login that may CREATE DATABASE works), otherwise LocalDB on this
/// Windows machine. With neither, the tests that need it are skipped by name (<see cref="LocalDbFactAttribute"/>)
/// rather than passing quietly: a race that never ran is not a race that was won.
/// </para>
/// <para>
/// Each test run creates databases named App_Tests_{guid}, so parallel agents and parallel CI jobs never
/// share one. A database left behind by a killed run is harmless; drop it by name.
/// </para>
/// </remarks>
public sealed class TestDatabase : IAsyncLifetime
{
    /// <summary>The environment variable naming a SQL Server to use instead of LocalDB.</summary>
    public const string ServerVariable = "TEST_SQL_CONNECTION";

    private const string LocalDb = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;TrustServerCertificate=true;Connect Timeout=10";

    private static readonly Lazy<string?> Server = new(FindServer);

    private readonly string name = $"App_Tests_{Guid.NewGuid():N}"[..40];
    private readonly bool migrate;

    /// <summary>A scratch database, migrated when it is created.</summary>
    public TestDatabase()
        : this(migrate: true)
    {
    }

    private TestDatabase(bool migrate) => this.migrate = migrate;

    /// <summary>A scratch database of its own (not the shared fixture), migrated or empty.</summary>
    /// <param name="migrate">Whether to apply the migrations when it is created.</param>
    public static TestDatabase Create(bool migrate) => new(migrate);

    /// <summary>Whether a SQL Server answers here, from the environment variable or LocalDB.</summary>
    public static bool Available => Server.Value is not null;

    /// <summary>Why the database tests are skipped, when they are.</summary>
    public static string SkipReason => $"No SQL Server: set {ServerVariable}, or install LocalDB (Windows).";

    /// <summary>The scratch database.</summary>
    public string ConnectionString => new SqlConnectionStringBuilder(Server.Value ?? LocalDb) { InitialCatalog = name }.ConnectionString;

    /// <inheritdoc />
    public async Task InitializeAsync()
    {
        if (!Available) return;
        await LocalDatabaseBootstrap.EnsureCreatedAsync(ConnectionString, CancellationToken.None);
        if (migrate) await new DatabaseMigrator(ConnectionString).ApplyAsync(null, CancellationToken.None);
    }

    /// <inheritdoc />
    public async Task DisposeAsync()
    {
        if (!Available) return;
        SqlConnection.ClearAllPools();
        await using var master = new SqlConnection(new SqlConnectionStringBuilder(Server.Value!) { InitialCatalog = "master" }.ConnectionString);
        await master.OpenAsync();
        await using var drop = master.CreateCommand();
        drop.CommandText = $"IF DB_ID('{name}') IS NOT NULL BEGIN ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}]; END";
        await drop.ExecuteNonQueryAsync();
    }

    private static string? FindServer()
    {
        var configured = Environment.GetEnvironmentVariable(ServerVariable);
        if (!string.IsNullOrWhiteSpace(configured))
        {
            // Configured means meant: a server that does not answer fails the run instead of skipping it.
            try
            {
                using var connection = new SqlConnection(new SqlConnectionStringBuilder(configured) { InitialCatalog = "master" }.ConnectionString);
                connection.Open();
                return configured;
            }
            catch (SqlException exception)
            {
                throw new InvalidOperationException($"{ServerVariable} is set, but that SQL Server does not answer: {exception.Message}", exception);
            }
        }

        // LocalDB is Windows only; elsewhere the client refuses the address with PlatformNotSupportedException.
        if (!OperatingSystem.IsWindows()) return null;
        try
        {
            using var connection = new SqlConnection(new SqlConnectionStringBuilder(LocalDb) { InitialCatalog = "master" }.ConnectionString);
            connection.Open();
            return LocalDb;
        }
        catch (SqlException)
        {
            return null;
        }
    }
}

/// <summary>The tests that share one migrated scratch database, one class at a time.</summary>
[CollectionDefinition(Name)]
public sealed class SharedDatabase : ICollectionFixture<TestDatabase>
{
    /// <summary>Its name.</summary>
    public const string Name = "Database";
}

/// <summary>A test that needs SQL Server (LocalDB or TEST_SQL_CONNECTION), skipped by name without one.</summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class LocalDbFactAttribute : FactAttribute
{
    /// <summary>Skips when no SQL Server is there.</summary>
    public LocalDbFactAttribute()
    {
        if (!TestDatabase.Available) Skip = TestDatabase.SkipReason;
    }
}

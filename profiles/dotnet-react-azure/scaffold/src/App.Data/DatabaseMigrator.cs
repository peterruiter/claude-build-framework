namespace App.Data;

using System.Globalization;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;

/// <summary>What happened to one migration file.</summary>
/// <param name="Name">File name, which is also the order it runs in.</param>
/// <param name="Applied">True when this run applied it, false when it was already applied.</param>
/// <param name="Batches">How many batches it contained.</param>
/// <param name="Elapsed">How long it took.</param>
public sealed record MigrationResult(string Name, bool Applied, int Batches, TimeSpan Elapsed);

/// <summary>
/// Applies the SQL migrations embedded in this assembly (db/migrations/*.sql), in ordinal name order.
/// </summary>
/// <remarks>
/// <para>
/// Embedded rather than read from disk, so a container carries its own schema and cannot be deployed
/// against a database it does not know how to build.
/// </para>
/// <para>
/// Every migration is written to be idempotent on its own: it creates what is absent and leaves what is
/// present alone, and it must apply cleanly to a brand-new database and a second time to the same one
/// (MigrationTests holds every file to both). The ledger (ops.SchemaMigration) is therefore not what makes
/// reruns safe; it is what makes them fast and what enforces the rule that an applied migration is never
/// edited: a file whose content no longer hashes to what was recorded is refused, because two databases
/// that both claim to be up to date would no longer be the same shape. Write a new migration instead.
/// </para>
/// <para>
/// Who runs this: a person, through the API's "migrate" command (build/Initialize-Database.ps1), signed in
/// as themselves. The deployed app's identity can read and write data but not change the schema, so it
/// only asks <see cref="PendingAsync"/> and says loudly when the database is behind.
/// </para>
/// <para>
/// Parallel agents and branches: reserve a numbered slot per piece of work (0100, 0200 ...) so two
/// migrations written at the same time never collide on a name.
/// </para>
/// </remarks>
/// <param name="connectionString">The database.</param>
public sealed partial class DatabaseMigrator(string connectionString)
{
    private const string ResourcePrefix = "App.Data.Migrations.";
    private const string LockName = "schema-migrations";

    [GeneratedRegex(@"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase)]
    private static partial Regex BatchSeparator();

    /// <summary>Every embedded migration, in the order its name implies.</summary>
    public static IReadOnlyList<(string Name, string Sql)> LoadMigrations()
    {
        var assembly = Assembly.GetExecutingAssembly();
        return [.. assembly.GetManifestResourceNames()
            .Where(name => name.StartsWith(ResourcePrefix, StringComparison.Ordinal) && name.EndsWith(".sql", StringComparison.OrdinalIgnoreCase))
            .Select(name => (Name: name[ResourcePrefix.Length..], Resource: name))
            // Ordinal, so 0100 sorts before 0200 and no culture can reorder a schema.
            .OrderBy(pair => pair.Name, StringComparer.Ordinal)
            .Select(pair => (pair.Name, Sql: Read(assembly, pair.Resource)))];
    }

    private static string Read(Assembly assembly, string resourceName)
    {
        using var stream = assembly.GetManifestResourceStream(resourceName)!;
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    /// <summary>Applies every migration that has not been applied yet.</summary>
    /// <param name="progress">Told about each file, so a long run says something.</param>
    /// <param name="cancellationToken">Cancellation.</param>
    /// <returns>One result per migration file.</returns>
    public async Task<IReadOnlyList<MigrationResult>> ApplyAsync(Action<string>? progress, CancellationToken cancellationToken)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(cancellationToken);

        // One process at a time. Two that start together (two local APIs, a test run beside a running
        // API) would otherwise both find a migration missing and both apply it; the second waits here,
        // then finds it in the ledger. Released by hand, because a pooled connection keeps its session.
        await using (var take = connection.CreateCommand())
        {
            take.CommandText = $"""
                DECLARE @result INT;
                EXEC @result = sp_getapplock @Resource = N'{LockName}', @LockMode = 'Exclusive', @LockOwner = 'Session', @LockTimeout = 600000;
                SELECT @result;
                """;
            take.CommandTimeout = 660;
            if (Convert.ToInt32(await take.ExecuteScalarAsync(cancellationToken), CultureInfo.InvariantCulture) < 0)
            {
                throw new InvalidOperationException("Another process has been applying migrations to this database for ten minutes. Let it finish, then run this again.");
            }
        }

        try
        {
            return await ApplyLockedAsync(connection, progress, cancellationToken);
        }
        finally
        {
            await using var release = connection.CreateCommand();
            release.CommandText = $"EXEC sp_releaseapplock @Resource = N'{LockName}', @LockOwner = 'Session';";
            await release.ExecuteNonQueryAsync(CancellationToken.None);
        }
    }

    /// <summary>The migrations this database is missing (or that changed), without applying any.</summary>
    /// <remarks>For the deployed app, which may not change the schema: it logs these rather than crashing.</remarks>
    /// <param name="cancellationToken">Cancellation.</param>
    public async Task<IReadOnlyList<string>> PendingAsync(CancellationToken cancellationToken)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(cancellationToken);

        await using var exists = connection.CreateCommand();
        exists.CommandText = "SELECT CASE WHEN OBJECT_ID('ops.SchemaMigration') IS NULL THEN 0 ELSE 1 END";
        var hasLedger = Convert.ToInt32(await exists.ExecuteScalarAsync(cancellationToken), CultureInfo.InvariantCulture) == 1;
        var applied = hasLedger ? await ReadLedgerAsync(connection, cancellationToken) : new Dictionary<string, string>(StringComparer.Ordinal);

        return [.. LoadMigrations()
            .Where(migration => !applied.TryGetValue(migration.Name, out var hash) || hash != Hash(migration.Sql))
            .Select(migration => migration.Name)];
    }

    private static async Task<IReadOnlyList<MigrationResult>> ApplyLockedAsync(SqlConnection connection, Action<string>? progress, CancellationToken cancellationToken)
    {
        await EnsureLedgerAsync(connection, cancellationToken);
        var applied = await ReadLedgerAsync(connection, cancellationToken);
        var results = new List<MigrationResult>();

        foreach (var (name, sql) in LoadMigrations())
        {
            cancellationToken.ThrowIfCancellationRequested();
            var hash = Hash(sql);

            if (applied.TryGetValue(name, out var recordedHash))
            {
                if (recordedHash != hash)
                {
                    throw new InvalidOperationException(
                        $"Migration '{name}' has changed since it was applied to this database. An applied migration is never " +
                        "edited, because two databases that both claim to be up to date would no longer be the same shape. " +
                        "Revert the file and write a new migration instead.");
                }

                results.Add(new MigrationResult(name, Applied: false, Batches: 0, Elapsed: TimeSpan.Zero));
                progress?.Invoke($"  {name} already applied");
                continue;
            }

            progress?.Invoke($"  {name} applying");
            var started = DateTime.UtcNow;
            var batches = await ExecuteAsync(connection, sql, name, cancellationToken);
            await RecordAsync(connection, name, hash, cancellationToken);
            results.Add(new MigrationResult(name, Applied: true, batches, DateTime.UtcNow - started));
        }

        return results;
    }

    private static async Task<int> ExecuteAsync(SqlConnection connection, string sql, string name, CancellationToken cancellationToken)
    {
        // One batch at a time, not one transaction: Azure SQL will not run several DDL statements on the
        // same object inside one transaction in the order migrations need, and a half-applied idempotent
        // migration is recoverable by running it again.
        var batches = BatchSeparator().Split(sql).Select(batch => batch.Trim()).Where(batch => batch.Length > 0).ToList();

        for (var index = 0; index < batches.Count; index++)
        {
            await using var command = connection.CreateCommand();
            command.CommandText = batches[index];
            command.CommandTimeout = 300;

            try
            {
                await command.ExecuteNonQueryAsync(cancellationToken);
            }
            catch (SqlException exception)
            {
                var excerpt = batches[index].Length <= 800 ? batches[index] : string.Concat(batches[index].AsSpan(0, 800), "\n...");
                throw new InvalidOperationException(
                    string.Create(CultureInfo.InvariantCulture, $"Migration '{name}' failed in batch {index + 1} of {batches.Count}: {exception.Message}\n\nThe batch was:\n{excerpt}"),
                    exception);
            }
        }

        return batches.Count;
    }

    private static async Task EnsureLedgerAsync(SqlConnection connection, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = """
            IF SCHEMA_ID('ops') IS NULL EXEC('CREATE SCHEMA ops');
            IF OBJECT_ID('ops.SchemaMigration') IS NULL
                CREATE TABLE ops.SchemaMigration
                (
                    Name        NVARCHAR(200) NOT NULL CONSTRAINT PK_SchemaMigration PRIMARY KEY,
                    ContentHash NVARCHAR(64)  NOT NULL,
                    AppliedUtc  DATETIME2(3)  NOT NULL CONSTRAINT DF_SchemaMigration_AppliedUtc DEFAULT SYSUTCDATETIME()
                );
            """;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task<Dictionary<string, string>> ReadLedgerAsync(SqlConnection connection, CancellationToken cancellationToken)
    {
        var applied = new Dictionary<string, string>(StringComparer.Ordinal);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT Name, ContentHash FROM ops.SchemaMigration";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken)) applied[reader.GetString(0)] = reader.GetString(1);
        return applied;
    }

    private static async Task RecordAsync(SqlConnection connection, string name, string hash, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = """
            MERGE ops.SchemaMigration WITH (HOLDLOCK) AS target
            USING (SELECT @name AS Name) AS source ON target.Name = source.Name
            WHEN MATCHED THEN UPDATE SET ContentHash = @hash, AppliedUtc = SYSUTCDATETIME()
            WHEN NOT MATCHED THEN INSERT (Name, ContentHash) VALUES (@name, @hash);
            """;
        command.Parameters.AddWithValue("@name", name);
        command.Parameters.AddWithValue("@hash", hash);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    /// <summary>The content hash, ignoring line endings (git rewrites them per platform).</summary>
    /// <param name="sql">The migration's text.</param>
    internal static string Hash(string sql) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(sql.Replace("\r\n", "\n", StringComparison.Ordinal))));
}

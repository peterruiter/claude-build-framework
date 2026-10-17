namespace App.Tests;

using System.Text.RegularExpressions;
using App.Data;
using Microsoft.Data.SqlClient;

/// <summary>
/// The migrations: every one applies to a brand-new database and a second time cleanly, the ledger refuses
/// a file that changed after it ran, and the files follow the naming rule.
/// </summary>
public sealed partial class MigrationTests
{
    [GeneratedRegex(@"^\d{4}_[a-z0-9_]+\.sql$")]
    private static partial Regex FileName();

    [Fact]
    public void Every_migration_is_numbered_once_and_named_in_lower_case()
    {
        var names = DatabaseMigrator.LoadMigrations().Select(migration => migration.Name).ToList();
        names.Should().NotBeEmpty();
        names.Should().OnlyContain(name => FileName().IsMatch(name), "a migration is NNNN_lower_case_words.sql");
        names.Select(name => name[..4]).Should().OnlyHaveUniqueItems("two migrations with one number apply in an order nobody chose");
        Directory.GetFiles(Path.Combine(Repository.Root(), "db", "migrations"), "*.sql").Should().HaveSameCount(names, "every file is embedded");
    }

    [LocalDbFact]
    public async Task Every_migration_applies_to_a_new_database_and_then_again_cleanly()
    {
        var database = TestDatabase.Create(migrate: false);
        await database.InitializeAsync();
        try
        {
            var migrator = new DatabaseMigrator(database.ConnectionString);
            var first = await migrator.ApplyAsync(null, CancellationToken.None);
            first.Should().OnlyContain(result => result.Applied);

            var second = await migrator.ApplyAsync(null, CancellationToken.None);
            second.Should().OnlyContain(result => !result.Applied);
            (await migrator.PendingAsync(CancellationToken.None)).Should().BeEmpty();

            // Idempotent on their own, not only through the ledger: run every file's SQL again by hand.
            await using var connection = new SqlConnection(database.ConnectionString);
            await connection.OpenAsync();
            foreach (var (name, sql) in DatabaseMigrator.LoadMigrations())
            {
                foreach (var batch in Regex.Split(sql, @"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase).Where(batch => batch.Trim().Length > 0))
                {
                    await using var command = connection.CreateCommand();
                    command.CommandText = batch;
                    var run = async () => await command.ExecuteNonQueryAsync();
                    await run.Should().NotThrowAsync($"{name} must be safe to run twice");
                }
            }
        }
        finally
        {
            await database.DisposeAsync();
        }
    }

    [LocalDbFact]
    public async Task A_migration_that_changed_after_it_ran_is_refused()
    {
        var database = TestDatabase.Create(migrate: true);
        await database.InitializeAsync();
        try
        {
            var name = DatabaseMigrator.LoadMigrations()[0].Name;
            await using (var connection = new SqlConnection(database.ConnectionString))
            {
                await connection.OpenAsync();
                await using var tamper = connection.CreateCommand();
                tamper.CommandText = "UPDATE ops.SchemaMigration SET ContentHash = 'changed' WHERE Name = @name";
                tamper.Parameters.AddWithValue("@name", name);
                await tamper.ExecuteNonQueryAsync();
            }

            var migrator = new DatabaseMigrator(database.ConnectionString);
            var apply = async () => await migrator.ApplyAsync(null, CancellationToken.None);
            (await apply.Should().ThrowAsync<InvalidOperationException>()).WithMessage($"*'{name}' has changed*");
            (await migrator.PendingAsync(CancellationToken.None)).Should().Contain(name);
        }
        finally
        {
            await database.DisposeAsync();
        }
    }

    [Fact]
    public void Line_endings_do_not_change_a_hash()
    {
        DatabaseMigrator.Hash("SELECT 1;\r\nGO\r\n").Should().Be(DatabaseMigrator.Hash("SELECT 1;\nGO\n"));
    }
}

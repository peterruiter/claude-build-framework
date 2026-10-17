namespace App.Tests;

using System.Text.Json;
using App.Data;
using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.DependencyInjection;

/// <summary>
/// The rules only SQL Server holds: find-or-create under concurrency, a shared rate limit across callers,
/// timestamps at the precision they are stored, and erasure covering every table.
/// </summary>
[Collection(SharedDatabase.Name)]
public sealed class DatabaseTests(TestDatabase database)
{
    [LocalDbFact]
    public async Task Twenty_requests_creating_the_same_tag_at_once_make_one_row_and_no_deadlock()
    {
        var store = new ItemStore(database.ConnectionString);
        var name = $"tag-{Guid.NewGuid():N}";

        var ids = await Task.WhenAll(Enumerable.Range(0, 20).Select(_ => Task.Run(() => store.EnsureTagAsync(name, CancellationToken.None))));

        ids.Distinct().Should().ContainSingle("every caller gets the one tag");
        await using var connection = new SqlConnection(database.ConnectionString);
        (await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM app.Tag WHERE Name = @name", new { name })).Should().Be(1);
    }

    [LocalDbFact]
    public async Task A_shared_limit_lets_exactly_the_limit_through_however_many_callers_race()
    {
        var store = new RateCounterStore(database.ConnectionString);
        var partition = $"test:{Guid.NewGuid():N}";

        var results = await Task.WhenAll(Enumerable.Range(0, 40).Select(_ => Task.Run(() => store.TakeAsync(partition, 10, TimeSpan.FromMinutes(1), CancellationToken.None))));

        results.Count(result => result.Allowed).Should().Be(10);
        results.Max(result => result.Hits).Should().Be(10, "a refused call is not counted");
    }

    [LocalDbFact]
    public async Task Stored_times_come_from_the_database_clock_at_millisecond_precision()
    {
        var store = new ItemStore(database.ConnectionString);
        var before = ItemStore.StoredPrecision(DateTime.UtcNow.AddSeconds(-5));

        var stored = await store.AddAsync($"item-{Guid.NewGuid():N}", ownerId: null, tag: null, CancellationToken.None);
        var read = (await store.RecentAsync(500, CancellationToken.None)).Single(item => item.ItemId == stored.ItemId);

        // Compare what was stored with what was read back, never with DateTime.UtcNow's ticks.
        read.CreatedUtc.Should().Be(stored.CreatedUtc);
        ItemStore.StoredPrecision(read.CreatedUtc).Should().Be(read.CreatedUtc, "DATETIME2(3) keeps milliseconds");
        // A generous window: the database's clock is not this machine's.
        read.CreatedUtc.Should().BeAfter(before).And.BeBefore(DateTime.UtcNow.AddMinutes(5));
    }

    [LocalDbFact]
    public async Task Every_table_is_covered_by_erasure_or_declared_free_of_personal_data()
    {
        await using var connection = new SqlConnection(database.ConnectionString);
        var tables = (await connection.QueryAsync<string>(
            "SELECT s.name + '.' + t.name FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE t.is_ms_shipped = 0")).ToList();

        using var privacy = JsonDocument.Parse(Repository.Contract("privacy"));
        var declaredFree = privacy.RootElement.GetProperty("tablesWithoutPersonalData").EnumerateObject().Select(property => property.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var erasure = Participants(database.ConnectionString);
        var covered = erasure.Participants.SelectMany(participant => participant.Tables).ToHashSet(StringComparer.OrdinalIgnoreCase);

        tables.Where(table => !declaredFree.Contains(table) && !covered.Contains(table)).Should().BeEmpty(
            "every table holds personal data and has an IErasureParticipant, or is listed in build/contracts/privacy.json with a reason");
        covered.Should().OnlyContain(table => tables.Contains(table, StringComparer.OrdinalIgnoreCase), "a participant names a table that exists");
    }

    [LocalDbFact]
    public async Task Erasing_a_person_removes_their_items_and_nobody_elses()
    {
        var store = new ItemStore(database.ConnectionString);
        var person = $"person-{Guid.NewGuid():N}";
        var other = $"person-{Guid.NewGuid():N}";
        await store.AddAsync("mine", person, null, CancellationToken.None);
        var theirs = await store.AddAsync("theirs", other, null, CancellationToken.None);

        await Participants(database.ConnectionString).EraseAsync(person, CancellationToken.None);

        var left = await store.RecentAsync(500, CancellationToken.None);
        left.Should().NotContain(item => item.OwnerId == person);
        left.Should().Contain(item => item.ItemId == theirs.ItemId);
    }

    /// <summary>Every participant, exactly as the API registers them in Program.cs.</summary>
    private static Erasure Participants(string connectionString)
    {
        using var api = new ApiFactory(connectionString);
        return api.Services.GetRequiredService<Erasure>();
    }
}

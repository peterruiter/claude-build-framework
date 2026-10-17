namespace App.Data;

using Dapper;
using Microsoft.Data.SqlClient;

/// <summary>One item, as stored.</summary>
/// <param name="ItemId">Its id.</param>
/// <param name="Name">Its name.</param>
/// <param name="OwnerId">Who made it (personal data: see ItemErasure), or null.</param>
/// <param name="TagId">Its tag, if any.</param>
/// <param name="CreatedUtc">When it was stored, by the database's clock, to the millisecond.</param>
public sealed record ItemRow(Guid ItemId, string Name, string? OwnerId, Guid? TagId, DateTime CreatedUtc);

/// <summary>
/// The sample store: replace it with your own. It shows three patterns worth keeping.
/// </summary>
/// <remarks>
/// <list type="number">
/// <item>Dapper with parameters, never string-built SQL.</item>
/// <item>
/// Insert-if-not-exists under concurrency (<see cref="EnsureTagAsync"/>): a plain IF NOT EXISTS then
/// INSERT races (two requests both see nothing and both insert, or deadlock on the index). UPDLOCK,
/// HOLDLOCK on the existence check takes a key-range lock that the second request waits on, so the
/// second one finds the first one's row. ItemStoreTests runs it twenty at a time.
/// </item>
/// <item>
/// Timestamps come from the database clock (SYSUTCDATETIME() defaults) and are DATETIME2(3): compare
/// them with values read back from the database, or truncated to milliseconds
/// (<see cref="StoredPrecision"/>), never with DateTime.UtcNow's ticks, or a test passes on one machine
/// and fails on the next.
/// </item>
/// </list>
/// </remarks>
/// <param name="connectionString">The database.</param>
public sealed class ItemStore(string connectionString)
{
    /// <summary>A time as DATETIME2(3) keeps it: truncated to the millisecond.</summary>
    /// <param name="value">A UTC time.</param>
    public static DateTime StoredPrecision(DateTime value) =>
        new(value.Ticks - (value.Ticks % TimeSpan.TicksPerMillisecond), DateTimeKind.Utc);

    /// <summary>The tag with this name, created when it does not exist yet. Safe under concurrency.</summary>
    /// <param name="name">The tag's name.</param>
    /// <param name="cancellationToken">Cancellation.</param>
    /// <returns>The tag's id.</returns>
    public async Task<Guid> EnsureTagAsync(string name, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        await using var connection = new SqlConnection(connectionString);
        return await connection.QuerySingleAsync<Guid>(new CommandDefinition(
            """
            SET NOCOUNT ON;
            SET XACT_ABORT ON;
            BEGIN TRANSACTION;
                DECLARE @id UNIQUEIDENTIFIER =
                    (SELECT TagId FROM app.Tag WITH (UPDLOCK, HOLDLOCK) WHERE Name = @name);
                IF @id IS NULL
                BEGIN
                    SET @id = NEWID();
                    INSERT INTO app.Tag (TagId, Name) VALUES (@id, @name);
                END
            COMMIT;
            SELECT @id;
            """, new { name }, cancellationToken: cancellationToken));
    }

    /// <summary>Stores an item and returns it as the database keeps it.</summary>
    /// <param name="name">The name.</param>
    /// <param name="ownerId">Who made it, or null.</param>
    /// <param name="tag">A tag name, or null.</param>
    /// <param name="cancellationToken">Cancellation.</param>
    public async Task<ItemRow> AddAsync(string name, string? ownerId, string? tag, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        Guid? tagId = string.IsNullOrWhiteSpace(tag) ? null : await EnsureTagAsync(tag, cancellationToken);

        await using var connection = new SqlConnection(connectionString);
        return await connection.QuerySingleAsync<ItemRow>(new CommandDefinition(
            """
            INSERT INTO app.Item (ItemId, Name, OwnerId, TagId)
            OUTPUT inserted.ItemId, inserted.Name, inserted.OwnerId, inserted.TagId, inserted.CreatedUtc
            VALUES (NEWID(), @name, @ownerId, @tagId);
            """, new { name, ownerId, tagId }, cancellationToken: cancellationToken));
    }

    /// <summary>The most recent items.</summary>
    /// <param name="take">How many.</param>
    /// <param name="cancellationToken">Cancellation.</param>
    public async Task<IReadOnlyList<ItemRow>> RecentAsync(int take, CancellationToken cancellationToken)
    {
        await using var connection = new SqlConnection(connectionString);
        var rows = await connection.QueryAsync<ItemRow>(new CommandDefinition(
            "SELECT TOP (@take) ItemId, Name, OwnerId, TagId, CreatedUtc FROM app.Item ORDER BY CreatedUtc DESC, ItemId;",
            new { take = Math.Clamp(take, 1, 500) }, cancellationToken: cancellationToken));
        return [.. rows];
    }

    /// <summary>How many items there are.</summary>
    /// <param name="cancellationToken">Cancellation.</param>
    public async Task<int> CountAsync(CancellationToken cancellationToken)
    {
        await using var connection = new SqlConnection(connectionString);
        return await connection.ExecuteScalarAsync<int>(new CommandDefinition("SELECT COUNT(*) FROM app.Item;", cancellationToken: cancellationToken));
    }
}

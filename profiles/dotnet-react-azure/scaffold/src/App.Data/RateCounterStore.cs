namespace App.Data;

using System.Data;
using System.Security.Cryptography;
using System.Text;
using Dapper;
using Microsoft.Data.SqlClient;

/// <summary>Where one partition's window stands after a call was counted.</summary>
/// <param name="Allowed">Whether the call fitted in the window.</param>
/// <param name="Hits">Calls the window has counted, this one included when it was allowed.</param>
/// <param name="UntilUtc">When the window ends.</param>
public readonly record struct RateCount(bool Allowed, int Hits, DateTime UntilUtc);

/// <summary>
/// Fixed-window rate limit counters in the database (ops.RateCounter), so every replica counts against
/// one budget. With three replicas, an in-memory limit of ten a minute is thirty a minute; this is ten.
/// </summary>
/// <remarks>
/// <para>
/// One round trip per check: a MERGE under HOLDLOCK on the partition's primary key adds the call and
/// returns where the window stands, starting a new window in place when the old one ended. A refused call
/// is not counted, so a flood does not push the window's end out.
/// </para>
/// <para>
/// The window's clock is the database's (SYSUTCDATETIME), not the replica's: replicas' clocks drift, and a
/// window that one replica thinks ended and another thinks running is two budgets again.
/// </para>
/// <para>Partitions are stored as a 128-bit hash, so no address or key is kept in clear.</para>
/// </remarks>
/// <param name="connectionString">The database.</param>
public sealed class RateCounterStore(string connectionString)
{
    /// <summary>The partition's key in the table: the first 128 bits of the SHA-256 of its name.</summary>
    /// <param name="partition">The limit's name and the partition, such as <c>sign-in:203.0.113.7</c>.</param>
    public static byte[] Key(string partition)
    {
        ArgumentNullException.ThrowIfNull(partition);
        return SHA256.HashData(Encoding.UTF8.GetBytes(partition))[..16];
    }

    /// <summary>Counts one call in a partition's window.</summary>
    /// <param name="partition">The partition.</param>
    /// <param name="limit">Calls a window.</param>
    /// <param name="window">The window's length.</param>
    /// <param name="cancellationToken">Cancellation.</param>
    public async Task<RateCount> TakeAsync(string partition, int limit, TimeSpan window, CancellationToken cancellationToken)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(limit, 1);
        var parameters = new DynamicParameters();
        parameters.Add("key", Key(partition), DbType.Binary, size: 16);
        parameters.Add("limit", limit, DbType.Int32);
        parameters.Add("windowMs", (int)window.TotalMilliseconds, DbType.Int32);

        await using var connection = new SqlConnection(connectionString);
        var row = await connection.QuerySingleAsync<(int Hits, int Before, DateTime UntilUtc)>(new CommandDefinition(
            """
            SET NOCOUNT ON;
            DECLARE @now DATETIME2(3) = SYSUTCDATETIME();
            DECLARE @until DATETIME2(3) = DATEADD(MILLISECOND, @windowMs, @now);
            MERGE ops.RateCounter WITH (HOLDLOCK) AS t
            USING (SELECT @key AS PartitionKey) AS s ON t.PartitionKey = s.PartitionKey
            WHEN MATCHED THEN UPDATE SET
                Hits = CASE WHEN t.UntilUtc > @now THEN t.Hits ELSE 0 END
                     + CASE WHEN CASE WHEN t.UntilUtc > @now THEN t.Hits ELSE 0 END < @limit THEN 1 ELSE 0 END,
                UntilUtc = CASE WHEN t.UntilUtc > @now THEN t.UntilUtc ELSE @until END
            WHEN NOT MATCHED THEN
                INSERT (PartitionKey, UntilUtc, Hits) VALUES (@key, @until, 1)
            OUTPUT inserted.Hits AS Hits, CASE WHEN deleted.UntilUtc > @now THEN deleted.Hits ELSE 0 END AS Before, inserted.UntilUtc AS UntilUtc;
            """, parameters, cancellationToken: cancellationToken));

        return new RateCount(row.Before < limit, row.Hits, DateTime.SpecifyKind(row.UntilUtc, DateTimeKind.Utc));
    }

    /// <summary>Deletes windows that ended, a few hundred at a time, skipping rows another call holds.</summary>
    /// <param name="cancellationToken">Cancellation.</param>
    public async Task<int> PruneAsync(CancellationToken cancellationToken)
    {
        await using var connection = new SqlConnection(connectionString);
        return await connection.ExecuteAsync(new CommandDefinition(
            "DELETE TOP (500) FROM ops.RateCounter WITH (READPAST) WHERE UntilUtc < SYSUTCDATETIME();", cancellationToken: cancellationToken));
    }
}

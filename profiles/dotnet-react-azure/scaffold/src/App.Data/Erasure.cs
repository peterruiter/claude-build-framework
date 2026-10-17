namespace App.Data;

using Dapper;
using Microsoft.Data.SqlClient;

/// <summary>
/// One store's part of "delete my data": which tables it holds personal data in, and how it deletes or
/// anonymises one person's rows.
/// </summary>
/// <remarks>
/// <para>
/// Every table in the database is either covered by a participant (<see cref="Tables"/>) or listed in
/// build/contracts/privacy.json under <c>tablesWithoutPersonalData</c>, with a reason. ErasureTests reads
/// the scratch database's tables after migrating it and fails on a table that is in neither: a new table
/// cannot ship without somebody deciding whether it holds personal data.
/// </para>
/// <para>
/// Delete what is only about the person; anonymise (null the link, keep the row) what other people's
/// records depend on, such as an order that is also bookkeeping. Write down which, in the participant.
/// </para>
/// </remarks>
public interface IErasureParticipant
{
    /// <summary>The tables this participant erases from, schema-qualified (app.Item).</summary>
    IReadOnlyList<string> Tables { get; }

    /// <summary>Deletes or anonymises one person's rows.</summary>
    /// <param name="personId">The person's id, as the product stores it.</param>
    /// <param name="cancellationToken">Cancellation.</param>
    /// <returns>Rows affected.</returns>
    Task<int> EraseAsync(string personId, CancellationToken cancellationToken);
}

/// <summary>The sample store's part: a person's items are theirs alone, so they are deleted.</summary>
/// <param name="connectionString">The database.</param>
public sealed class ItemErasure(string connectionString) : IErasureParticipant
{
    /// <inheritdoc />
    public IReadOnlyList<string> Tables { get; } = ["app.Item"];

    /// <inheritdoc />
    public async Task<int> EraseAsync(string personId, CancellationToken cancellationToken)
    {
        await using var connection = new SqlConnection(connectionString);
        return await connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM app.Item WHERE OwnerId = @personId;", new { personId }, cancellationToken: cancellationToken));
    }
}

/// <summary>Runs every participant for one person.</summary>
/// <param name="participants">Every registered participant.</param>
public sealed class Erasure(IEnumerable<IErasureParticipant> participants)
{
    /// <summary>The participants, for the coverage test.</summary>
    public IReadOnlyList<IErasureParticipant> Participants { get; } = [.. participants];

    /// <summary>Erases a person everywhere; rows affected per table group.</summary>
    /// <param name="personId">The person.</param>
    /// <param name="cancellationToken">Cancellation.</param>
    public async Task<IReadOnlyDictionary<string, int>> EraseAsync(string personId, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(personId);
        var affected = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var participant in Participants)
        {
            affected[string.Join(',', participant.Tables)] = await participant.EraseAsync(personId, cancellationToken);
        }

        return affected;
    }
}

-- ===========================================================================
-- The sample tables (ItemStore). Replace with your own; keep the habits:
--
--   * Every statement checks for what it is about to create.
--   * Timestamps are DATETIME2(3) with a SYSUTCDATETIME() default: the
--     database's clock, to the millisecond, the same for every replica.
--   * A unique key backs every "find or create" (Tag.Name), and the code that
--     finds or creates takes UPDLOCK, HOLDLOCK on the lookup.
--   * Adding a column later: IF COL_LENGTH('app.Item', 'Colour') IS NULL
--     ALTER TABLE app.Item ADD Colour NVARCHAR(20) NULL;  in a NEW file.
--
-- Idempotent. Never edit once applied; write a new migration.
-- ===========================================================================

IF OBJECT_ID('app.Tag') IS NULL
BEGIN
    CREATE TABLE app.Tag
    (
        TagId       UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Tag PRIMARY KEY,
        Name        NVARCHAR(100)    NOT NULL CONSTRAINT UQ_Tag_Name UNIQUE,
        CreatedUtc  DATETIME2(3)     NOT NULL CONSTRAINT DF_Tag_CreatedUtc DEFAULT SYSUTCDATETIME()
    );
END
GO

IF OBJECT_ID('app.Item') IS NULL
BEGIN
    CREATE TABLE app.Item
    (
        ItemId      UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Item PRIMARY KEY,
        Name        NVARCHAR(200)    NOT NULL,
        -- Who made it: personal data, so ItemErasure deletes a person's items (privacy.json).
        OwnerId     NVARCHAR(100)    NULL,
        TagId      UNIQUEIDENTIFIER NULL CONSTRAINT FK_Item_Tag REFERENCES app.Tag (TagId),
        CreatedUtc  DATETIME2(3)     NOT NULL CONSTRAINT DF_Item_CreatedUtc DEFAULT SYSUTCDATETIME()
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Item_CreatedUtc' AND object_id = OBJECT_ID('app.Item'))
    CREATE INDEX IX_Item_CreatedUtc ON app.Item (CreatedUtc DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Item_OwnerId' AND object_id = OBJECT_ID('app.Item'))
    CREATE INDEX IX_Item_OwnerId ON app.Item (OwnerId) WHERE OwnerId IS NOT NULL;
GO

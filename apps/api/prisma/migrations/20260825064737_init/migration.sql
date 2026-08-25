-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('GOOGLE');

-- CreateEnum
CREATE TYPE "NodeType" AS ENUM ('FOLDER', 'FILE');

-- CreateEnum
CREATE TYPE "BlobStatus" AS ENUM ('PENDING', 'READY');

-- CreateEnum
CREATE TYPE "ShareMode" AS ENUM ('LINK', 'USER');

-- CreateEnum
CREATE TYPE "ShareRole" AS ENUM ('VIEWER');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT,
    "avatar_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "Provider" NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_rooms" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "total_size" BIGINT NOT NULL DEFAULT 0,
    "file_count" INTEGER NOT NULL DEFAULT 0,
    "folder_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "data_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nodes" (
    "id" UUID NOT NULL,
    "data_room_id" UUID NOT NULL,
    "parent_id" UUID,
    "type" "NodeType" NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "size" BIGINT NOT NULL DEFAULT 0,
    "total_size" BIGINT NOT NULL DEFAULT 0,
    "file_count" INTEGER NOT NULL DEFAULT 0,
    "folder_count" INTEGER NOT NULL DEFAULT 0,
    "blob_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blobs" (
    "id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "checksum" TEXT,
    "status" "BlobStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shares" (
    "id" UUID NOT NULL,
    "data_room_id" UUID NOT NULL,
    "node_id" UUID,
    "mode" "ShareMode" NOT NULL,
    "role" "ShareRole" NOT NULL DEFAULT 'VIEWER',
    "token_hash" TEXT,
    "grantee_email" TEXT,
    "created_by_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_provider_account_id_key" ON "accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE INDEX "data_rooms_owner_id_deleted_at_idx" ON "data_rooms"("owner_id", "deleted_at");

-- CreateIndex
CREATE INDEX "nodes_data_room_id_name_idx" ON "nodes"("data_room_id", "name");

-- CreateIndex
CREATE INDEX "nodes_blob_id_idx" ON "nodes"("blob_id");

-- CreateIndex
CREATE UNIQUE INDEX "blobs_storage_key_key" ON "blobs"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "shares_token_hash_key" ON "shares"("token_hash");

-- CreateIndex
CREATE INDEX "shares_grantee_email_revoked_at_idx" ON "shares"("grantee_email", "revoked_at");

-- CreateIndex
CREATE INDEX "shares_node_id_revoked_at_idx" ON "shares"("node_id", "revoked_at");

-- CreateIndex
CREATE INDEX "shares_data_room_id_revoked_at_idx" ON "shares"("data_room_id", "revoked_at");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_rooms" ADD CONSTRAINT "data_rooms_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_data_room_id_fkey" FOREIGN KEY ("data_room_id") REFERENCES "data_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_blob_id_fkey" FOREIGN KEY ("blob_id") REFERENCES "blobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shares" ADD CONSTRAINT "shares_data_room_id_fkey" FOREIGN KEY ("data_room_id") REFERENCES "data_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shares" ADD CONSTRAINT "shares_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shares" ADD CONSTRAINT "shares_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- The five statements below cannot be expressed declaratively in the Prisma
-- schema. They are reproduced from docs/data-model.md; change them there first.
-- ---------------------------------------------------------------------------

-- 1. Name uniqueness within a folder: case-insensitive, ignoring soft-deleted rows.
--    COALESCE handles root-level nodes, where parent_id IS NULL and NULLs would
--    otherwise be treated as distinct by a plain unique index.
CREATE UNIQUE INDEX "nodes_parent_name_unique"
  ON "nodes" (data_room_id, COALESCE(parent_id, data_room_id), lower(name))
  WHERE deleted_at IS NULL;

-- 2. Subtree range scans: LIKE 'prefix%' needs a pattern-ops index to be used.
--    data_room_id leads because every subtree statement filters it by equality first
--    (equality column leading, range column second).
CREATE INDEX "nodes_path_prefix"
  ON "nodes" (data_room_id, path text_pattern_ops);

-- 3. Structural integrity between type and blob.
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_type_blob_check" CHECK (
  (type = 'FILE'   AND blob_id IS NOT NULL) OR
  (type = 'FOLDER' AND blob_id IS NULL)
);

-- 4. Exactly one grant target shape per share mode.
ALTER TABLE "shares" ADD CONSTRAINT "shares_mode_check" CHECK (
  (mode = 'LINK' AND token_hash IS NOT NULL AND grantee_email IS NULL) OR
  (mode = 'USER' AND grantee_email IS NOT NULL AND token_hash IS NULL)
);

-- 5. Folder listing + keyset pagination. The sort key is lower(name), not name, so that
--    it matches the uniqueness domain in statement 1. Ordering on one and paginating on
--    the other is what drops or duplicates a row at a page boundary.
CREATE INDEX "nodes_listing"
  ON "nodes" (data_room_id, COALESCE(parent_id, data_room_id), type, lower(name))
  WHERE deleted_at IS NULL;

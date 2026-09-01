/*
  Warnings:

  - You are about to drop the column `route` on the `Recommendation` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `Recommendation` table. All the data in the column will be lost.
  - Added the required column `destination` to the `Recommendation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `origin` to the `Recommendation` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Recommendation" DROP COLUMN "route",
DROP COLUMN "type",
ADD COLUMN     "destination" "Destination" NOT NULL,
ADD COLUMN     "origin" "Destination" NOT NULL,
ADD COLUMN     "tripType" TEXT NOT NULL DEFAULT 'BASE';

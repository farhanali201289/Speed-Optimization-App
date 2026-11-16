-- CreateTable
CREATE TABLE "SpeedTest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "metrics" TEXT NOT NULL,
    "audits" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Optimization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "themeId" TEXT NOT NULL,
    "themeName" TEXT NOT NULL,
    "fixes" TEXT NOT NULL,
    "backups" TEXT NOT NULL,
    "createdFiles" TEXT NOT NULL,
    "speedTestId" TEXT,
    "rolledBack" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "SpeedTest_shop_createdAt_idx" ON "SpeedTest"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "Optimization_shop_createdAt_idx" ON "Optimization"("shop", "createdAt");

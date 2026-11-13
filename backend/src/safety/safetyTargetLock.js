const TARGET_LOCK_NAMESPACE = "zbt:safety-target:";

export async function lockSafetyTarget(client, targetType, targetId) {
  if (typeof targetType !== "string" || !targetType || typeof targetId !== "string" || !targetId) {
    throw new TypeError("lockSafetyTarget requires a target type and target ID");
  }
  await client.query(
    `SELECT pg_advisory_xact_lock(
       hashtextextended('${TARGET_LOCK_NAMESPACE}' || $1 || ':' || $2, 0)
     )`,
    [targetType, targetId]
  );
}

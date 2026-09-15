/**
 * Automatically assigns a new order to an active staff member.
 *
 * Uses round-robin assignment.
 *
 * This function must be called inside a transaction.
 */
async function getNextStaffForOrder(connection) {
    // Lock assignment state so two simultaneous orders
    // cannot select the same "next" staff member.
    const [stateRows] = await connection.query(
        `
      SELECT id, last_staff_id
      FROM order_assignment_state
      WHERE id = 1
      FOR UPDATE
    `
    );

    if (!stateRows[0]) {
        throw new Error(
            'Order assignment state is not initialized'
        );
    }

    const lastStaffId = stateRows[0].last_staff_id;

    let staffRows;

    if (lastStaffId) {
        [staffRows] = await connection.query(
            `
        SELECT id, name
        FROM admins
        WHERE role = 'staff'
          AND is_active = 1
          AND id > ?
        ORDER BY id ASC
        LIMIT 1
      `,
            [lastStaffId]
        );
    }

    // If nobody exists after the previous staff member,
    // wrap around to the first active staff member.
    if (!staffRows?.length) {
        [staffRows] = await connection.query(
            `
        SELECT id, name
        FROM admins
        WHERE role = 'staff'
          AND is_active = 1
        ORDER BY id ASC
        LIMIT 1
      `
        );
    }

    // No active staff available.
    if (!staffRows.length) {
        return null;
    }

    const staff = staffRows[0];

    await connection.query(
        `
      UPDATE order_assignment_state
      SET last_staff_id = ?
      WHERE id = 1
    `,
        [staff.id]
    );

    return staff;
}

module.exports = { getNextStaffForOrder }
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'domiciliaria.db');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        console.error("Error opening db:", err.message);
        return;
    }
    db.all(`
        SELECT dm.order_id, dm.latitude, dm.longitude, dm.resolved_address, dm.resolved_localidad
        FROM delivery_metadata dm
    `, [], (err, rows) => {
        if (err) {
            console.error("Query error:", err.message);
            return;
        }
        console.log("=== delivery_metadata ===");
        console.log(JSON.stringify(rows, null, 2));
    });
});

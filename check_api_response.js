async function run() {
    try {
        const res = await fetch('http://localhost:3000/api/deliveries');
        const json = await res.json();
        const orders = json.data || [];
        const specific = orders.filter(o => o.client_name.includes('San Antonio'));
        console.log("San Antonio orders summary from API:");
        specific.forEach(o => {
            console.log(`ID: ${o.id} | Name: ${o.client_name} | Address: ${o.address} | Locality: ${o.localidad} | Order Date: ${o.order_date}`);
        });
    } catch (e) {
        console.error(e);
    }
}

run();

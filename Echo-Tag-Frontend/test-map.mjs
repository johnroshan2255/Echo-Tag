import { Client } from '@colyseus/sdk';

const client = new Client('ws://localhost:2567');
(async () => {
    try {
        console.log("Connecting...");
        const room = await client.create('arena', { code: 'TEST1' });
        console.log("Joined. State phase:", room.state.phase, "mapIndex:", room.state.mapIndex);
        
        let changed = false;
        room.onStateChange((state) => {
            console.log("State updated! roundMins:", state.roundMins, "mapIndex:", state.mapIndex);
            if (state.roundMins === 5) {
                changed = true;
                console.log("SUCCESS! The server successfully changed the mins.");
                process.exit(0);
            }
        });

        console.log("Sending MSG.Mins (m) with value 5");
        room.send('m', 5);

        setTimeout(() => {
            if (!changed) {
                console.error("FAIL: State roundMins did not update within 2 seconds.");
                process.exit(1);
            }
        }, 2000);
    } catch (e) {
        console.error("Error:", e);
        process.exit(1);
    }
})();

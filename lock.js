const zookeeper = require("node-zookeeper-client");

const ZK_SERVER = "127.0.0.1:2181"; // Change to your ZooKeeper ensemble
const LOCK_PATH = "/locks";

const client = zookeeper.createClient(ZK_SERVER);
client.connect();

function acquireLock(timeOut = 5000) {
    client.create(
        `${LOCK_PATH}/lock_`,
        Buffer.from("lock"),
        zookeeper.CreateMode.EPHEMERAL_SEQUENTIAL,
        (error, path) => {
            if (error) {
                console.log("Failed to acquire lock:", error);
                return;
            }
            console.log(`Lock request created: ${path}`);
            const timeOutId = setTimeout(() => {
                console.log("Timeout! Could not acquire lock.");
                client.remove(path, () => {}); // Clean up if waiting too long
            }, timeOut);

            checkForLock(path, timeOutId);
        }
    );
}

function checkForLock(path, timeOutId) {
    client.getChildren(LOCK_PATH, (error, children) => {
        if (error) {
            console.log("Error getting children:", error);
            return;
        }
        console.log('children: ', children);
        children.sort(); // Sort to get the smallest ZNode
        const myLock = path.split("/").pop();
        if (children[0] === myLock) {
            console.log("Lock acquired:", myLock);
            clearTimeout(timeOutId);
        } else {
            console.log(`Waiting for lock... Current lock holder: ${children[0]}`);
            watchPreviousNode(myLock, children, timeOutId);
        }
    });
}

function watchPreviousNode(myLock, children, timeOutId) {
    const index = children.indexOf(myLock);
    if (index > 0) {
        const previousNode = `${LOCK_PATH}/${children[index - 1]}`;
        
        client.exists(previousNode, (event) => {
            console.log(`Lock released, checking again: ${event}`);
            
            // Ensure we continue watching for the lock
            if (event && event.getType() === zookeeper.Event.NODE_DELETED) {
                checkForLock(myLock, timeOutId);
            } else {
                // Re-watch in case of a missed event
                watchPreviousNode(myLock, children, timeOutId);
            }
        });
    }
}


// Ensure the locks directory exists
client.mkdirp(LOCK_PATH, (error) => {
    if (!error || error.code === zookeeper.Exception.NODE_EXISTS) {
        acquireLock();
    } else {
        console.log("Error creating lock directory:", error);
    }
});

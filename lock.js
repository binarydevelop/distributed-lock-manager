const zookeeper = require("node-zookeeper-client");

const ZK_SERVER = "127.0.0.1:2181"; // Change to your ZooKeeper ensemble
const LOCK_PATH = "/locks";

const client = zookeeper.createClient(ZK_SERVER);
client.connect();

function acquireLock() {
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
            checkForLock(path);
        }
    );
}

function checkForLock(path) {
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
        } else {
            console.log(`Waiting for lock... Current lock holder: ${children[0]}`);
            watchPreviousNode(myLock, children);
        }
    });
}

function watchPreviousNode(myLock, children) {
    const index = children.indexOf(myLock);
    if (index > 0) {
        const previousNode = `${LOCK_PATH}/${children[index - 1]}`;
        client.exists(previousNode, (event) => {
            console.log(`Lock released, checking again: ${event}`);
            checkForLock(myLock);
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

const zookeeper = require("node-zookeeper-client");

const ZK_SERVER = "127.0.0.1:2181"; // Change to your ZooKeeper ensemble
const LOCK_PATH = "/locks";

const client = zookeeper.createClient(ZK_SERVER);
client.connect();

function acquireLock(isWriter = false, timeOut = 5000) {
    const lockType = isWriter ? "write_" : "read_";
    
    client.create(
        `${LOCK_PATH}/${lockType}`,
        Buffer.from(lockType),
        zookeeper.CreateMode.EPHEMERAL_SEQUENTIAL,
        (error, path) => {
            if (error) {
                console.log("Failed to acquire lock:", error);
                return;
            }
            console.log(`Lock request created: ${path}`);
            
            // Timeout handler if lock is not acquired in time
            const timeOutId = setTimeout(() => {
                console.log("Timeout! Could not acquire lock. Releasing...");
                client.remove(path, () => {}); // Cleanup if waiting too long
            }, timeOut);

            checkForSharedLock(path, isWriter, timeOutId);
        }
    );
}

function checkForSharedLock(path, isWriter, timeOutId) {
    client.getChildren(LOCK_PATH, (error, children) => {
        if (error) {
            console.log("Error getting children:", error);
            return;
        }
        console.log('Current lock queue:', children);
        
        children.sort(); // Sort ZNodes to determine priority
        const myLock = path.split("/").pop();

        const hasWriter = children.some(child => child.startsWith("write_"));
        const isFirst = children[0] === myLock;

        if (isWriter) {
            if (isFirst) {
                console.log("✏️ Writer lock acquired:", myLock);
                clearTimeout(timeOutId);
            } else {
                console.log("🛑 Writer waiting for readers to finish...");
                watchPreviousNode(myLock, children, timeOutId);
            }
        } else {
            if (!hasWriter) {
                console.log("📖 Reader lock acquired:", myLock);
                clearTimeout(timeOutId);
            } else {
                console.log("⏳ Reader waiting for writer...");
                watchPreviousNode(myLock, children, timeOutId);
            }
        }
    });
}

function watchPreviousNode(myLock, children, timeOutId) {
    const index = children.indexOf(myLock);
    if (index > 0) {
        const previousNode = `${LOCK_PATH}/${children[index - 1]}`;
        
        client.exists(previousNode, (event) => {
            if (event && event.getType() === zookeeper.Event.NODE_DELETED) {
                console.log(`🔔 Lock released, checking again...`);
                checkForSharedLock(myLock, false, timeOutId);
            } else {
                console.log(`👀 Watching ${previousNode} for deletion...`);
                watchPreviousNode(myLock, children, timeOutId);
            }
        });
    }
}

// Ensure the locks directory exists
client.mkdirp(LOCK_PATH, (error) => {
    if (!error || error.code === zookeeper.Exception.NODE_EXISTS) {
        const isWriter = process.argv.includes("writer"); // Run as writer if "writer" argument is passed
        acquireLock(isWriter);
    } else {
        console.log("Error creating lock directory:", error);
    }
});

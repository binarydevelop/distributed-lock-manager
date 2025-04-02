const zookeeper = require('node-zookeeper-client');

const ZK_SERVER = '127.0.0.1:2181'; // ZooKeeper server
const LOCK_NODE = '/lock';

let client = zookeeper.createClient(ZK_SERVER);
let myZNode = null;

client.once('connected', async () => {
    console.log('🔗 Connected to ZooKeeper');
    await ensureLockNode();
    await acquireLock();
});

client.connect();

/**
 * Ensure that the parent /lock ZNode exists.
 */
function ensureLockNode() {
    return new Promise((resolve, reject) => {
        client.exists(LOCK_NODE, (error, stat) => {
            if (error) return reject(error);
            if (stat) return resolve(); // Already exists

            client.create(LOCK_NODE, Buffer.from(''), zookeeper.ACL.OPEN_ACL_UNSAFE, zookeeper.CreateMode.PERSISTENT, (err) => {
                if (err && err.code !== zookeeper.Exception.NODE_EXISTS) return reject(err);
                resolve();
            });
        });
    });
}

/**
 * Try to acquire a distributed lock.
 */
function acquireLock() {
    return new Promise((resolve, reject) => {
        client.create(`${LOCK_NODE}/lock-`, Buffer.from(''), zookeeper.ACL.OPEN_ACL_UNSAFE, zookeeper.CreateMode.EPHEMERAL_SEQUENTIAL, async (err, path) => {
            if (err) return reject(err);

            myZNode = path;
            console.log(`📝 Created lock node: ${myZNode}`);

            await checkLock();
            resolve();
        });
    });
}

/**
 * Check if the current ZNode has the lowest sequence (i.e., has the lock).
 */
function checkLock() {
    return new Promise((resolve, reject) => {
        client.getChildren(LOCK_NODE, (err, children) => {
            if (err) return reject(err);

            children.sort(); // Sort in ascending order
            const smallestNode = `${LOCK_NODE}/${children[0]}`;

            if (myZNode === smallestNode) {
                console.log(`🔐 Lock acquired: ${myZNode}`);
                performTask();
            } else {
                // Watch the node just before myZNode
                const myIndex = children.indexOf(myZNode.replace(`${LOCK_NODE}/`, ''));
                if (myIndex > 0) {
                    const prevNode = `${LOCK_NODE}/${children[myIndex - 1]}`;
                    console.log(`👀 Watching previous node: ${prevNode}`);
                    watchNode(prevNode);
                }
            }
            resolve();
        });
    });
}

/**
 * Watch the previous ZNode for deletion.
 */
function watchNode(prevNode) {
    client.exists(prevNode, (event) => {
        if (event.type === zookeeper.Event.NODE_DELETED) {
            console.log(`✅ Lock is now available (previous node deleted). Trying again...`);
            checkLock();
        }
    });
}

/**
 * Perform the task and release the lock.
 */
function performTask() {
    console.log(`🚀 Performing critical task...`);
    setTimeout(() => {
        releaseLock();
    }, 2000);
}

/**
 * Release the lock by deleting the ZNode.
 */
function releaseLock() {
    if (myZNode) {
        client.remove(myZNode, -1, (err) => {
            if (err) {
                console.error('❌ Error releasing lock:', err);
            } else {
                console.log(`🔓 Lock released: ${myZNode}`);
            }
            client.close();
        });
    }
}

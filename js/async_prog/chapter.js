/* eslint-disable prefer-promise-reject-errors */

/* Asynchronous Programming */

import { bigOak, defineRequestType, everywhere } from './crow-tech.js';

bigOak.readStorage('food caches', (caches) => {
    const firstCache = caches[0];
    bigOak.readStorage(firstCache, (info) => {
        console.log(info);
    });
});
// to be able to receive a request it has to be defined
// the second argument is the request handler
defineRequestType('note', (nest, content, source, done) => {
    console.log(`${nest.name} received note: ${content}`);
    done();
});
// the last argument is a function that is called when a response comes
bigOak.send('Cow Pasture', 'note', "Let's caw loudly at 7PM", () => {
    console.log('Note delivered.');
});

// Promises
const fifteen = Promise.resolve(15);
fifteen.then(val => console.log(`Got ${val}`),
    val => console.log(`Didn't get ${val}`));
fifteen.then(val => console.log(`Get ${val} again`));
// 'then' method takes as the second argument, a function to be executed
// when the promise is rejected
const data = Promise.reject('data');
data.then(val => console.log(`Got ${val}`),
    val => console.log(`Didn't get ${val}`));

// a promise based representation of the 'readStorage' function
function storage(nest, name) {
    return new Promise((resolve) => {
        nest.readStorage(name, result => resolve(result));
    });
}
// it returns a promise, so that a specific code can be run after
// it is resolved(or rejected)
storage(bigOak, 'enemies').then(val => console.log('Got', val));

const failure = new Promise((_, reject) => reject(new Error('Fail')));
// because the promise is rejected and this 'then' call doesn't have
// a second function to handle rejections, nothing will happen
failure.then(val => console.log('Handler 1', val))
    // the 'catch' method receives the reason(exception), and outputs it
    // it then returns a not promise value, which creates a resolved promise with that value
    .catch((reason) => {
        console.log(`Caught failure ${reason}`);
        return 'nothing';
    })
    // because the promise is resolved now, the second handler can be executed
    .then(val => console.log('Handler 2', val));


class Timeout extends Error {}

function request(nest, target, type, content) {
    return new Promise((resolve, reject) => {
        let done = false;
        function attempt(n) {
            // send the request
            // the last argument is the function to be executed after the response was received
            nest.send(target, type, content, (failed, value) => {
                done = true;
                if (failed) reject(failed);
                else resolve(value);
            });
            // if the request wasn't done in 250ms, retry or reject it
            // if it was, return it's status(resolved or rejected promise)
            setTimeout(() => {
                if (done) return;
                if (n < 3) attempt(n + 1);
                else reject(new Timeout('Timed out'));
            }, 250);
        }
        attempt(1);
    });
}

// a promise based interface for defining new types
function requestType(name, handler) {
    defineRequestType(name, (nest, content, source, callback) => {
        try {
            Promise.resolve(handler(nest, content, source))
                // if the promise is resolved, assign the response to the callback
                // the first value holds an error(if any)
                .then(response => callback(null, response),
                    // if failed, 'report' the error to the callback
                    failed => callback(failed));
        } catch (err) {
            // any other exceptions are also registered
            callback(err);
        }
    });
}

requestType('ping', () => 'pong');

function availableNeighbors(nest) {
    const requests = nest.neighbors.map(neighbor => (
        request(nest, neighbor, 'ping').then(() => true, () => false)
    ));
    return Promise.all(requests).then(result => (
        nest.neighbors.filter((_, i) => result[i])
    ));
}

console.log(availableNeighbors(bigOak));

// Network flooding
// floods a network with an information until all nodes have it

everywhere((nest) => {
    nest.state.gossip = [];
});

function sendGossip(nest, message, exceptFor = null) {
    nest.state.gossip.push(message);
    for (const neighbor of nest.neighbors) {
        if (neighbor !== exceptFor) {
            request(nest, neighbor, 'gossip', message);
        }
    }
}

requestType('gossip', (nest, message, source) => {
    if (nest.state.gossip.includes(message)) return;
    console.log(`${nest.name} received gossip '${message}' from ${source}.`);
    sendGossip(nest, message, source);
});

// sendGossip(bigOak, 'Kids with airgun in the park.');

// sends the nest's connections to it's neighbors, except for the source
function broadcastConnections(nest, name, exceptFor = null) {
    for (const neighbor of nest.neighbors) {
        if (neighbor !== exceptFor) {
            request(nest, neighbor, 'connections', {
                // the nest's connections
                name,
                neighbors: nest.state.connections.get(name),
            });
        }
    }
}

requestType('connections', (nest, { name, neighbors }, source) => {
    const { connections } = nest.state;
    // if the current nest has the connections from the received message({ name, neighbors })
    // JSON.stringify was used to be able to evaluate 2 arrays
    if (JSON.stringify(connections.get(name)) === JSON.stringify(neighbors)) {
        return;
    }
    // if it doesn't have the connections from the received message,
    // add them to the nest's 'connections' Map
    connections.set(name, neighbors);
    // send the received information to the adjacent nest's, except from the source
    broadcastConnections(nest, name, source);
});

// returns the next step in the wanted direction('to')
// given the current place and connections
function findRoute(from, to, connections) {
    const routes = [{ at: from, via: null }];
    for (let i = 0; i < routes.length; i++) {
        const { at, via } = routes[i];
        for (const next of connections.get(at) || []) {
            if (next === to) return via;
            // if the current position('next') is not in the routes array,
            // add it, so that it will be checked for the destination too
            if (!routes.some(r => r.at === next)) {
                routes.push({ at: next, via: via || next });
            }
        }
    }
    return null;
}

function routeRequest(nest, target, type, content) {
    if (nest.neighbors.includes(target)) {
        request(nest, target, type, content);
    } else {
        let via = findRoute(nest.name, target, nest.state.connections);
        if (!via) throw new Error(`No route to ${target}`);
        request(nest, via, 'route', { target, type, content });
    }
}

requestType('route', (nest, { target, type, content }) => (
    routeRequest(nest, target, type, content)
));

everywhere((nest) => {
    nest.state.connections = new Map();
    nest.state.connections.set(nest.name, nest.neighbors);
    // send the nest's connections to all the other nests in the network
    broadcastConnections(nest, nest.name);
});
// this function call depends on the broadcastConnection()
// it should first await for it to finish
// routeRequest(bigOak, 'Church Tower', 'note', 'Incoming jackdaws!');


// create global variables to be able to access it in the browser's console
// it is done for debugging purposes
// leaving imported/module variables in the global scope is a bad practice
window.bigOak = bigOak;
window.availableNeighbors = availableNeighbors;
window.everywhere = everywhere;
window.sendGossip = sendGossip;
window.findRoute = findRoute;
window.routeRequest = routeRequest;
'use strict';

var faker = require('faker');
var moment = require('moment');

let express = require('express');
let app = express();
let http = require('http').Server(app);
let io = require('socket.io')(http);
//var port = process.env.PORT || 8081;

var Redis = require('ioredis');
var redis_address = process.env.REDIS_ADDRESS || 'redis://127.0.0.1:6379';

var redis = new Redis(redis_address);
var redis_subscribers = {};
var channel_history_max = 10;

app.use(express.static('public'));
app.get('/health', function(request, response) {
    response.send('ok');
});

function add_redis_subscriber(subscriber_key) {
    var client = new Redis(redis_address);

    client.subscribe(subscriber_key);
    client.on('message', function(channel, message) {
        io.emit(subscriber_key, JSON.parse(message));
    });

    redis_subscribers[subscriber_key] = client;
}
add_redis_subscriber('messages');
add_redis_subscriber('memberAdd');
add_redis_subscriber('memberDelete');

function generateUUID () { // Public Domain/MIT
    var d = new Date().getTime();
    if (typeof performance !== 'undefined' && typeof performance.now === 'function'){
        d += performance.now(); //use high-precision timer if available
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = (d + Math.random() * 16) % 16 | 0;
        d = Math.floor(d / 16);
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

io.on('connection', (socket) => {
	console.log('user connected');
    var get_members = redis.hgetall('members').then(function(redis_members) {
        var members = {};
        for (var key in redis_members) {
            members[key] = JSON.parse(redis_members[key]);
        }
        return members;
    });

    var initialize_member = get_members.then(function(members) {
        if (members[socket.id]) {
            return members[socket.id];
        }

        var username = faker.fake("{{name.firstName}} {{name.lastName}}");
        var member = {
            id: socket.id,
            user: username,
            avatar: "//api.adorable.io/avatars/30/" + username + '.png'
        };

        return redis.hset('members', socket.id, JSON.stringify(member)).then(function() {
            return member;
        });
    });

    // get the highest ranking messages (most recent) up to channel_history_max size
    var get_messages = redis.zrange('messages', -1 * channel_history_max, -1).then(function(result) {
        return result.map(function(x) {
            return JSON.parse(x);
        });
    });

    Promise.all([get_members, initialize_member, get_messages]).then(function(values) {
        var members = values[0];
        var member = values[1];
        var messages = values[2];

        io.emit('memberHistory', members);
        io.emit('messageHistory', messages);

        redis.publish('memberAdd', JSON.stringify(member));

     //    socket.on('add-message', (message) => {
    	// 		io.emit('message', {type:'new-message', text: message});    
  			// });

        socket.on('send', function(message_text) {
        		console.log(message_text);
            var date = moment.now();
            var message = JSON.stringify({
                date: date,
                user: member['user'],
                avatar: member['avatar'],
                message: message_text,
                id: generateUUID()
            });
	            io.emit('message', message);
            redis.zadd('messages', date, message);
            redis.publish('messages', message);
        });

        socket.on('disconnect', function() {
        		console.log('User disconnected');
            redis.hdel('members', socket.id);
            redis.publish('memberDelete', JSON.stringify(socket.id));
        });
    }).catch(function(reason) {
        console.log('ERROR: ' + reason);
    });
});

http.listen(5000, () => {
  console.log('started on port 5000');
});

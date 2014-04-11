var
    fs     = require('fs'),
    http   = require('http'),
    Manta  = require('manta-client'),
    mkdirp = require('mkdirp'),
    parse  = require('parse-json-response'),
    path   = require('path'),
    spawn  = require('child_process').spawn,
    test   = require('tap').test,
    url    = require('url')
    ;

// just in case it was still alive from a previous run, kill it.
require('./test-zz-teardown.js');

// just make sure we can load a client, or crash early
var client = require('./client.js');
client.close();

// run with the cwd of the main program.
var cwd = path.dirname(__dirname);

var conf = path.resolve(__dirname, 'fixtures', 'couch.ini');
var pidfile = path.resolve(__dirname, 'fixtures', 'pid');
var logfile = path.resolve(__dirname, 'fixtures', 'couch.log');
var started = /Apache CouchDB has started on http:\/\/127\.0\.0\.1:15984\/\n$/;

var fix = path.join(__dirname, 'fixtures', 'destinations');
test('make fixture dirs', function(t) {
    for (var i = 0; i < 9; i++) {
        mkdirp.sync(path.join(fix, '' + i));
    }
    t.pass('ok');
    t.end();
});

test('set up manta directories', function(t) {
    var manta = Manta(process.argv, process.env);
    var count = 0; // async on the cheap

    ['9', '10', '11', '12'].forEach(function(d) {
        manta.mkdirp('~~/stor/registry-testing/' + d, function(err) {
            if (err) throw(err);
            count++;
            if (count === 4) {
                manta.close();
                t.pass('multifishes');
                t.end();
            }
        });
    });
});

test('start couch as a zombie child', function (t) {
    var fd = fs.openSync(pidfile, 'wx')

    try { fs.unlinkSync(logfile) } catch (er) {}

    var child = spawn('couchdb', ['-a', conf], {
        detached: true,
        stdio: 'ignore',
        cwd: cwd
    })
    child.unref()
    t.ok(child.pid)
    fs.writeSync(fd, child.pid + '\n')
    fs.closeSync(fd)

    // wait for it to create a log, give it 5 seconds
    var start = Date.now()
    fs.readFile(logfile, function R (er, log) {
        log = log ? log.toString() : ''
        if (!er && !log.match(started))
            er = new Error('not started yet')
        if (er) {
            if (Date.now() - start < 5000)
                return setTimeout(function () {
                    fs.readFile(logfile, R)
                }, 100)
            else
                throw er
        }
        t.pass('relax')
        t.end()
    })
})

test('create test db', function(t) {
    var u = url.parse('http://admin:admin@localhost:15984/registry')
    u.method = 'PUT'
    http.request(u, function(res) {
        t.equal(res.statusCode, 201)
        var c = ''
        res.setEncoding('utf8')
        res.on('data', function(chunk) {
            c += chunk
        })
        res.on('end', function() {
            c = JSON.parse(c)
            t.same(c, { ok: true })
            t.end()
        })
    }).end()
})

test('create test record', function(t) {
    var testPkg = require('./fixtures/test-package.json')
    var tf = path.resolve(__dirname, 'fixtures/test-package-0.0.0.tgz')
    var tgzData = fs.readFileSync(tf, 'base64')
    testPkg._attachments['test-package-0.0.0.tgz'].data = tgzData
    testPkg._attachments['test-package-0.0.0.tgz'].stub = false
    testPkg._attachments['test-package-0.0.0-blerg.tgz'] =
        JSON.parse(JSON.stringify(testPkg._attachments['test-package-0.0.0.tgz']))

    var body = new Buffer(JSON.stringify(testPkg))
    var u = url.parse('http://admin:admin@localhost:15984/registry/test-package')
    u.method = 'PUT'
    u.headers = {
        'content-type': 'application/json',
        'content-length': body.length,
        connection: 'close'
    }
    http.request(u, function(res) {
        t.equal(res.statusCode, 201)
        if (res.statusCode !== 201)
            res.pipe(process.stderr)
        t.end()
    }).end(body)
})

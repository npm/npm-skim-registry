'use strict';

var
    lab      = require('lab'),
    describe = lab.describe,
    it       = lab.it,
    before   = lab.before,
    demand   = require('must'),
    fs       = require('fs'),
    Manta    = require('manta-client'),
    mkdirp   = require('mkdirp'),
    path     = require('path'),
    spawn    = require('child_process').spawn
    ;

describe('setup', function()
{
    it('can create test destination directories', function(done)
    {
        var fix = path.join(__dirname, 'tmp', 'registry-testing');
        mkdirp.sync(path.join(fix, '0'));
        mkdirp.sync(path.join(fix, '1'));
        done();
    });

    // run with the cwd of the main program.
    var cwd = path.dirname(__dirname);

    var conf = path.resolve(__dirname, 'fixtures', 'couch.ini');
    var pidfile = path.resolve(__dirname, 'couch-tmp', 'pid');
    var logfile = path.resolve(__dirname, 'couch-tmp', 'couch.log');
    var started = /Apache CouchDB has started on http:\/\/127\.0\.0\.1:15984\/\n$/;

    it('can set up couch tmp directory', function(done)
    {
        fs.mkdirSync(path.join(__dirname, 'couch-tmp'));

        var files = ['_replicator.couch', '_users.couch', 'registry.couch'];
        files.forEach(function(f)
        {
            var src = path.resolve(__dirname, 'fixtures', f);
            var dest = path.resolve(__dirname, 'couch-tmp', f);
            fs.writeFileSync(dest, fs.readFileSync(src))
        });

        done();
    });

    it('can start couch as a zombie child', { timeout: 25000 }, function(done)
    {
        if (process.env.WERCKER_COUCHDB_HOST)
        {
            console.log(process.env);
            return done();
        }


        var fd = fs.openSync(pidfile, 'wx');
        try { fs.unlinkSync(logfile); } catch (er) {}
        var child = spawn('couchdb', ['-a', conf], {
            detached: true,
            stdio: 'ignore',
            cwd: cwd
        });
        child.unref();

        child.pid.must.be.truthy();
        fs.writeSync(fd, child.pid + '\n');
        fs.closeSync(fd);

        // wait for it to create a log, give it 15 seconds
        var start = Date.now();

        fs.readFile(logfile, function R(err, log)
        {
            log = log ? log.toString() : '';
            if (!err && !log.match(started))
                err = new Error('not started yet');
            if (err)
            {
                if (Date.now() - start < 25000)
                    return setTimeout(function () { fs.readFile(logfile, R) }, 1000);
                else
                    demand(err).be.falsy();
            }
            done();
        });
    });

});

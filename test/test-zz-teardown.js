'use strict';

var
    lab      = require('lab'),
    describe = lab.describe,
    it       = lab.it,
    before   = lab.before,
    demand   = require('must'),
    fs       = require('fs'),
    Manta    = require('manta-client'),
    path     = require('path'),
    rimraf   = require('rimraf');

describe('cleanup', function()
{
    it('can kill the couch zombie', function(done)
    {
        var pidfile = path.resolve(__dirname, 'couch-tmp', 'pid');
        var pid;
        try { pid = fs.readFileSync(pidfile); } catch (err) {}

        if (pid)
        {
            try { process.kill(pid); } catch (err) { err.code.must.equal('ESRCH'); }
        }

        done();
    });

    it('can clean up the couch tmp dir', function(done)
    {
        rimraf(path.resolve(__dirname, 'couch-tmp'), function(err)
        {
            demand(err).be.falsy();
            done();
        });
    });

    it('can cleanup the destination directories', function(done)
    {
        rimraf(path.join(__dirname, 'tmp'), function(err)
        {
            demand(err).be.falsy();
            done();
        });
    });

    it('can gut the multifishes', { timeout: 30000 }, function(done)
    {
        var manta = Manta(process.argv, process.env);
        manta.rmr('~~/stor/registry-testing/', function(err)
        {
            if (err && (err.statusCode !== 404 && err.code !== 'ENOENT'))
                demand(err).be.falsy();

            manta.close();
            done();
        });
    });
});

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

var
    pidfile = path.resolve(__dirname, 'fixtures', 'pid'),
    _users  = path.resolve(__dirname, 'fixtures', '_users.couch'),
    db      = path.resolve(__dirname, 'fixtures', 'registry.couch'),
    log     = path.resolve(__dirname, 'fixtures', 'couch.log'),
    repl    = path.resolve(__dirname, 'fixtures', '_replicator.couch')
    ;

describe('cleanup', function()
{
    it('can kill the couch zombie', function(done)
    {
        try { var pid = fs.readFileSync(pidfile); } catch (er) {}

        if (pid)
        {
            try { process.kill(pid); } catch (err) { err.code.must.equal('ESRCH'); }
        }

        try { fs.unlinkSync(pidfile) } catch (err) { err.code.must.equal('ENOENT'); }
        try { fs.unlinkSync(repl) } catch (err) { err.code.must.equal('ENOENT'); }
        try { fs.unlinkSync(log) } catch (err) { err.code.must.equal('ENOENT'); }
        try { fs.unlinkSync(_users) } catch (err) { err.code.must.equal('ENOENT'); }
        try { fs.unlinkSync(db) } catch (err) { err.code.must.equal('ENOENT'); }

        done();
    });

    it('can gut the multifishes', { timeout: 10000 }, function(done)
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

    it('can cleanup the destination directories', function(done)
    {
        rimraf(path.join(__dirname, 'tmp'), function(err)
        {
            demand(err).be.falsy();
            done();
        });
    });

});

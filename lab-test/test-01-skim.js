'use strict';

var
    lab      = require('lab'),
    describe = lab.describe,
    it       = lab.it,
    before   = lab.before,
    after    = lab.after,
    demand   = require('must'),
    http     = require('http'),
    parse    = require('parse-json-response'),
    skim     = require('../skim.js'),
    url      = require('url'),
    util     = require('util')
    ;

describe('skimming', function()
{
    var client;

    before(function(done)
    {
        client = require('./client.js');
        done();
    });

    it('emits expected events on a first sync', function(done)
    {
        var skimmer;
        var expected =
        {
            'put test-package' : 1,
            'attachment test-package/_attachments/test-package-0.0.0.tgz' : 1,
            'sent test-package/doc.json' : 1,
            'sent test-package/_attachments/test-package-0.0.0.tgz' : 1,
            'complete test-package': 1
        };

        function checkEvent()
        {
            var str = util.format.apply(util, arguments);
            expected.must.have.property(str);

            expected[str]--;
            if (expected[str] === 0)
                delete expected[str];

            if (Object.keys(expected).length === 0)
            {
                skimmer.destroy();
                done();
            }
        }

        var opts =
        {
            debug         : true,
            client        : client,
            db            : 'http://localhost:15984/registry',
            path          : '.',
            seq           : 0,
            inactivity_ms : 10000
        };

        skimmer = skim(opts)
        .on('put', function(change) { checkEvent('put %s', change.id); })
        .on('rm', function(change) { checkEvent('rm %s', change.id); })
        .on('send', function(change, file) { checkEvent('sent %s', file); })
        .on('delete', function(change, file) { checkEvent('delete %s', file); })
        .on('attachment', function(change, file) { checkEvent('attachment %s', file); })
        .on('complete', function(change, results) { checkEvent('complete %s', change.id); })
        .on('error', function(err)
        {
            if (err.stackTrace)
                console.error(err.stackTrace());
            else
                console.error(err);
            throw(err);
        });
    });

    it('writes files with correct md5 sums', function(done)
    {
        var target = 'test-package/_attachments/test-package-0.0.0.tgz';
        client.md5(target, function(err, res, data)
        {
            demand(err).be.falsy();
            console.log(res);
            res.should.be.a.string();
            done();
        });
    });

    it('removes the attachment from couch', function(done)
    {
        var opts = url.parse('http://localhost:15984/registry/test-package');
        opts.headers = { 'connection': 'close' };
        http.get(opts, parse(function(err, data, response)
        {
            demand(err).be.falsy();
            data.must.be.an.object();
            data.must.not.have.property('_attachments');
            done();
        }));
    });

    after(function(done)
    {
        client.close();
        done();
    });
});

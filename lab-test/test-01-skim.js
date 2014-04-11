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

    it('emits expected events when operating');

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

'use strict';

var
    lab      = require('lab'),
    describe = lab.describe,
    it       = lab.it,
    before   = lab.before,
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

    it('emits expected events');
    it('writes files with correct md5 sums');
    it('removes the attachment from couch');

    after(function(done)
    {
        client.close();
        done();
    });
});

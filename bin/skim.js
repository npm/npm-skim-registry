#!/usr/bin/env node

// TODO finish revising this for multi-fs

var MultiFS = require('multi-fs');
var Skim = require('../');
var dashdash = require('dashdash');
var parser = dashdash.createParser({
  options: [
    { names: [ 'config', 'f' ],
      type: 'string',
      help: 'config file for multifs targets',
      helpArg: 'FILE' },
    { names: [ 'seq-file', 'Q' ],
      type: 'string',
      help: 'File to store the sequence in',
      helpArg: 'FILE' },
    { names: [ 'seq', 'q' ],
      type: 'number',
      help: 'Sequence ID to start at',
      helpArg: 'NUMBER' },
    { names: [ 'registry', 'r' ],
      type: 'string',
      help: 'The registry where attachments can be found.  Optional.',
      helpArg: 'URL' },
    { names: [ 'inactivity-ms' ],
      type: 'number',
      help: 'Max ms to wait before assuming disconnection.',
      helpArg: 'MS' },
    { names: [ 'delete', 'd' ],
      type: 'bool',
      help: 'Delete removed attachments and docs from targets' },
    { names: [ 'skim', 's'] ,
      type: 'string',
      helpArg: 'URL',
      help: 'Target to write attachment free docs. ' +
            'Defaults to put back into COUCHDB arg.' },
    { names: ['help', 'h'],
      type: 'bool',
      help: 'Print this help and exit' },

  ]
});

var opts = parser.parse(process.argv, process.env);
var args = opts._args;

if (opts.help || args.length !== 4)
  return usage();

var targets = require(opts.config);
var client = new MultiFS(targets);

var db = args[2];
var path = args[3];
var seqFile = opts.seq_file;
var seq = opts.seq;
var inactivity_ms = opts.inactivity_ms;
var del = opts.delete;
var skim = opts.skim || opts.db;
var registry = opts.registry || null;


if (!db || !path) {
  usage();
  process.exit(1);
}

function usage() {
  console.log(usage.toString().split(/\n/).slice(4, -2).join('\n'));
  console.log(parser.help());
/*
npm-skim-registry - Skim the fat out of your registry couchdb
Usage: npm-skim-registry [args] COUCHDB MANTAPATH

    COUCHDB                             Full url to your couch, like
                                        http://localhost:5984/database
    MANTAPATH                           Remote path in Manta, like
                                        ~~/stor/database
*/
}



Skim({
  client: client,
  db: db,
  path: path,
  seqFile: seqFile,
  inactivity_ms: inactivity_ms,
  seq: seq,
  delete: del,
  skim: skim,
  registry: registry
}).on('put', function(change) {
  console.log('PUT %s', change.id);
}).on('rm', function(change) {
  console.log('RM %s', change.id);
}).on('send', function(change, file) {
  console.log('-> sent %s/%s', change.id, file.name);
}).on('delete', function(change, remote) {
  console.log('-> deleted %s/%s', change.id, remote);
}).on('putBack', function(change) {
  console.error('-> putback %s', change.id);
});

var
    mkdirp = require('mkdirp'),
    path = require('path');

if (!process.env.MANTA_KEY_ID || !process.env.MANTA_USER || !process.env.MANTA_URL)
{
    console.error('not ok - need manta environs');
    process.exit(1);
}

if (!process.env.SSH_AUTH_SOCK)
{
    console.error('not ok - only ssh-agent authentication is supported');
    process.exit(1);
}

var devbase = path.resolve(__dirname, 'skimdev');
mkdirp.sync(devbase);

module.exports =
[
    { type: 'fs', path: devbase + '/0' },
    'ssh://localhost:' + devbase + '/1',
    '~~/stor/skimdev/2',
];

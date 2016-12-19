var five = require("johnny-five");
var felixLib = require("./felix");

var board = new five.Board();
var felix = null;

var config = {
  granularity:4,
  speed:30,
  geometry:{ femur:44, tibia:74, height:100, step_height:15, step_width:26 },
  gaits:{'deer_creep':[ //expected order FR, FL, BR, BL 
                        [4,2,3,1],
                        [1,3,4,2],
                        [2,4,1,3],
                        [3,1,2,4]
                      ],
          'cat_creep':[
                        [4,1,2,3],
                        [1,2,3,4],
                        [2,3,4,1],
                        [3,4,1,2],
                      ]
        },
  legs:[  //expected order FR, FL, BR, BL
                      {
                         id:'FR',
                         label:'Front right',
                         origin:{x:8,y:0},
                         hip:{ pin:0, offset:2, invert:false },
                         knee:{ pin:1, offset:4, invert:false }
                      },
                      {
                         id:'FL',
                         label:'Front left',
                         origin:{x:18,y:0},
                         hip:{ pin:2, offset:3, invert:true },
                         knee:{ pin:3, offset:-4, invert:true }
                      },
                      {
                         id:'BR',
                         label:'Back right',
                         origin:{x:10,y:0},
                         hip:{ pin:4, offset:-2, invert:true },
                         knee:{ pin:5, offset:-6, invert:true }
                      },
                      {
                         id:'BL',
                         origin:{x:-2,y:0},
                         label:'Back left',
                         hip:{ pin:6, offset:-3, invert:false },
                         knee:{ pin:7, offset:-4, invert:false }
                      }
                   ]
              };


board.on("ready", function() {
  console.log('');
  console.log('******************************************');
  console.log(' WELCOME TO FELIX ');
  console.log(' Use the arrow keys to control Felix ');
  console.log(' Use the space bar to pause the current action');
  console.log('');
  console.log(' felix is added to the REPL, so you can call methods directly');
  console.log(' like >>felix.forward()');
  console.log('');
  console.log(' Have fun =)');
  console.log('******************************************');

  felix = new felixLib.Felix(config,five);
  felix.stand();

  this.repl.inject({
    felix:felix
  });


  //comment this section out if you plan to interact with the REPL.
  //The space bar is used as a command 
  var stdin = process.stdin;
  stdin.setRawMode( true );
  stdin.resume();
  stdin.setEncoding( 'utf8' );

  stdin.on( 'data', function( key ){

    var direction = { '\u001B\u005B\u0041':'forward',
                      '\u001B\u005B\u0042':'backward',
                      '\u001B\u005B\u0044':'left',
                      '\u001B\u005B\u0043':'right',
                      '\u0020':'pause'
                    };

    var cmd = direction[key];
    if(cmd)
    {
      if(cmd =='pause') return felix.pause();
      if(cmd =='forward') return felix.forward();
      console.log('command not implemented yet:'+ cmd);
      return;
    }

    if ( key === '\u0003' ) process.exit();
  });

});

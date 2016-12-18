/*******************************************************************
* This is a module to control Felix a 3D printed quadruped robot
* robot with eight degrees of freedom
********************************************************************/
var Felix = function(config,J5){
  this.config = config;
  this.J5 = J5;
  this._legSetup();
  this.schedule = [];
  this.scheduleIdx = 0;
  this._intervalId = null;
  this.cycle_idx = 0;
  this.state = '';
};

/**********************************************************
* pose method to make felix stand
* @param height int distance from the ground to the hip
**********************************************************/
Felix.prototype.stand = function(height){
  height = (typeof height === 'undefined')? this.config.geometry.height:height;
  for(var i = 0; i < this.legs.length;i++){
    this.positionLeg(this.legs[i].id,{x:0,y:height});
  }
}

/**********************************************************
* walk forward
**********************************************************/
Felix.prototype.forward = function(){
  if(this.state == 'forward_pause')
  {
    this._runSchedule();
    this.state = 'forward';
    return;
  }

  var c = this._genwalk();
  c.push({cmd:'loop',count:-1});
  this.schedule = c;
  this.cycle_idx = 0;
  this.scheduleIdx = 0;
  this._runSchedule();
  this.state = 'forward';
}


/**********************************************************
* pause the current schedule, if allready pause resume it 
**********************************************************/
Felix.prototype.pause = function(){
  if(this.state.indexOf('_pause') != -1)
  {
    this.state = this.state.replace('_pause','');
    this._runSchedule();
    return;
  }
  this.state += '_pause';
  clearTimeout(this._intervalId);
}

/**********************************************************
* Calibrate the servos original position 
* the femur segment should be at a 90 degrees angles to the body
* the tip (feet/toe) of the tibia segment (not the side) should
* be at 90 degrees relative to the femur segment
**********************************************************/
Felix.prototype.calibrate = function(){
  for(var i = 0 ; i < this.legs.length; i++){
    this.legs[i].hip.servo.to(90 + this.legs[i].hip.offset );
    this.legs[i].knee.servo.to(90 + this.legs[i].knee.offset );
  }
  return 'calibrating legs';
};

/**********************************************************
* Calibrate one leg at a time 
* @param id string leg-id
**********************************************************/
Felix.prototype.calibrateLeg = function(id){
  var i = this._legIdx(id);
  this.legs[i].hip.servo.to(90 + this.legs[i].hip.offset );
  this.legs[i].knee.servo.to(90 + this.legs[i].knee.offset );
  return 'calibrating '+ this.legs[i].label;
}


/**********************************************************
* adjust the leg position to reach for the provided pose
* @param id string leg id
* @param pose int 
**********************************************************/
Felix.prototype.poseLeg = function(id,pose){
  var p = this._genPosePoint(pose);
  var angles = this._legAngles(id,p);
  this._legPositionByAngles(id,angles);
  return 'move '+ this.legs[this._legIdx(id)].label +' to pose '+ pose +' (x:'+ p.x +',y:'+ p.y +')';
};

/**********************************************************
* adjust the leg position to reach for the provided end point 
* @param id string leg id
* @param endPoint object { x:int, y:int }
**********************************************************/
Felix.prototype.positionLeg = function(id,endPoint){
  var angles = this._legAngles(id,endPoint);
  this._legPositionByAngles(id,angles);
  return 'move '+ this.legs[this._legIdx(id)].label +' to (x:'+ endPoint.x +',y:'+ endPoint.y +')';
};

/**********************************************************
* adjust the leg to it's home position 
* @param id string leg id
**********************************************************/
Felix.prototype.homeLeg = function(id){
  this.positionLeg(id,{x:0,y:this.config.geometry.height});
  return 'move '+ this.legs[this._legIdx(id)].label +' to its home position (x:0, y:'+ this.config.geometry.height +')';
};



//******************* PRIVATE METHODS **********************

/**********************************************************
* go through frames in the current schedule
**********************************************************/
Felix.prototype._runSchedule = function(){
  if(this.scheduleIdx  >= this.schedule.length) return;

  var frame = this.schedule[this.scheduleIdx];

  if(frame.cmd == 'loop'){
    if(frame.count == 0) return;
    if(frame.count > 0) this.schedule[this.scheduleIdx].count--; 

    this.scheduleIdx = 0;
    this.cycle_idx++;
    this._runSchedule();
    return;
  }

  if(frame.cmd == 'pose'){
    this._legsPositionByAngles(frame.angles);
  }

  this.scheduleIdx++;
  this._intervalId = setTimeout(this._runSchedule.bind(this),this.config.speed);
}

/**********************************************************
* Generate the frames (leg poses) for a walk cycle
* @param orientation string (straight|right|left)
* @return frames array [{cmd:pose,angles:[{hip:int,knee:int}..]}..]
**********************************************************/
Felix.prototype._genwalk = function(orientation){
    var frames = [];

    var gait = this.config.gait;
    for(var i = 0; i < gait.length; i++){
      frames.push(this._genPoseFrame(gait[i]));

      var nextPoseIdx = ((i+1) >= gait.length)? 0:i + 1;

      var poseTransition = this._genPoseTransition(gait[i],gait[nextPoseIdx]);

      for(var j = 0; j < poseTransition.length; j++){
        frames.push(poseTransition[j]);
      }
    }
    return frames;
}

/**********************************************************
* Generate a transition array from one pose to the next.
* @param pose array four integers representing each leg pose position
* @return frames list [{cmd:pose,angles:[{hip:int,knee:int}..]}..]
**********************************************************/
Felix.prototype._genPoseTransition = function(pose_a, pose_b){
  var frames = [];
  var inbetweens = [];

  var pose_points_a = this._genPosePoints(pose_a);
  var pose_points_b = this._genPosePoints(pose_b);

  for(var i = 0; i < pose_a.length; i++){
    var from_point = pose_points_a[i];
    var to_point =  pose_points_b[i];

    if(pose_a[i] == 4){ //pin
      var radius_x = Math.abs(from_point.x - to_point.x) / 2;
      var midpoint_x = (from_point.x > to_point.x )? to_point.x:from_point.x;
      midpoint_x+= radius_x;

      var arc =  {
                    origin:{ x:midpoint_x, y:to_point.y },
                    radius:{ x:radius_x, y:this.config.geometry.step_height },
                    start_angle:360, 
                    end_angle:180
                 };
  
      inbetweens.push(this._ellipticalTrajectory(arc,
                                                 this.config.granularity,true));
      continue;
    } 

    inbetweens.push(this._linearTrajectory({ a:from_point,b:to_point },
                                         this.config.granularity,true));
  }

  for(var i = 0; i < inbetweens[0].length;i++){
    var frame = { cmd:'pose', angles:[], points:[],context:{from:pose_a,to:pose_b} };

    for(var j = 0; j < inbetweens.length;j++){
      var points = inbetweens[j][i];
      frame.points.push(points);
      frame.angles.push(this._legAngles(this.legs[j].id,points));
    }
    frames.push(frame);
  }

  return frames;
}

/**********************************************************
* Generate the end-points for a given pose
* @param pose array four integers representing each leg pose position
* @return posePoints array [{x:int,y:int},..]
**********************************************************/
Felix.prototype._genPosePoints = function(pose){
   var posePoints = [];

   var liftLeg = ''; 
   for(var i = 0; i < pose.length; i++){
     if(pose[i] == 4) liftLeg = this.legs[i].id;
   }

   var diagonalLeg = this._diagonalLeg(liftLeg);
   var samesideLeg = this._samesideLeg(liftLeg);
   var oppositeLeg = this._oppositeLeg(liftLeg); 

   for(var i = 0; i < pose.length; i++){
     var p = this._genPosePoint(pose[i]);

     var y = p.y;
     if(this.legs[i].id == diagonalLeg) y = y - 3;
     if(this.legs[i].id == oppositeLeg) y = y - 1;
     if(this.legs[i].id == samesideLeg) y = y + 2;
     p.y = y;

     posePoints.push(p);
   }
   return posePoints;
}

/**********************************************************
* Generate a single end-point for a given pose
* @param pose int pose-position
* @return posePoint {x:int,y:int}
**********************************************************/
Felix.prototype._genPosePoint = function(pose){
     var x = this._posePositionX(pose,this.config.geometry.step_width);
     var y = this.config.geometry.height; 
     return {x:x,y:y};
}

/**********************************************************
* Generate a pose frame. Generate the leg positions for a give pose
* in a walk cycle
* @param pose array four integers representing each leg pose position
* @return frames object {cmd:pose,angles:[{hip:int,knee:int}..]}
**********************************************************/
Felix.prototype._genPoseFrame = function(pose){
   var posePoints = this._genPosePoints(pose);
   var poseFrame = { cmd:'pose', angles: [], 
                     context: pose, points: posePoints };

   for(var i = 0; i < posePoints.length; i++){
     poseFrame.angles.push(this._legAngles(this.legs[i].id,posePoints[i]));
   }
   return poseFrame;
}

/**********************************************************
 * Finds the x position corresponding to the requested 
 * step pose. A step is split in four segments
 * @param {pose} Number an integer between 1 and 4.
 **********************************************************/
Felix.prototype._posePositionX = function(pose,step_width) {
  var half_segment = (step_width / 3) / 2; 
  var poses = [(step_width / 2) * -1, half_segment * -1, half_segment, step_width / 2];
  return poses[pose - 1];
}

/**********************************************************
* setup method to initialize the servos based 
* on the config values
**********************************************************/
Felix.prototype._legSetup = function(){
  this.legs = JSON.parse(JSON.stringify(this.config.legs));

  for(var i = 0; i < this.legs.length; i++){
    this.legs[i].hip.servo = new this.J5.Servo({
                          controller: "PCA9685",
                          address: 0x40,
                          invert:this.legs[i].hip.invert,
                          pin: this.legs[i].hip.pin,
                          range:[0,180],
                          specs: { speed:this.J5.Servo.Continuous.speeds["@5.0V"] }
                        });

    this.legs[i].knee.servo = new this.J5.Servo({
                          controller: "PCA9685",
                          address: 0x40,
                          invert:this.legs[i].knee.invert,
                          pin: this.legs[i].knee.pin,
                          range:[0,180],
                          specs: { speed:this.J5.Servo.Continuous.speeds["@5.0V"] }
                        });
  }
};

/**********************************************************
* get the leg angles needed to reach the provided end point 
* @param endPoint object { x:int, y:int }
* @return angles object { hip:int, knee:int }
**********************************************************/
Felix.prototype._legAngles = function(id,endPoint){
  var i= this._legIdx(id);
  var origin = this.legs[i].origin;

  if(id == 'BL' || id == 'BR') endPoint.x *= -1;

  return this._IK(this.config.geometry.femur, 
                  this.config.geometry.tibia, 
                  origin,
                  endPoint);
};

/**********************************************************
* adjust the leg position to the rotation of the provided angles 
* @param id string leg id
* @param angles object { hip:int, knee:int }
**********************************************************/
Felix.prototype._legPositionByAngles = function(id,angles){
  var idx = this._legIdx(id);

  var hip = angles.hip + this.legs[idx].hip.offset;
  var knee = angles.knee + this.legs[idx].knee.offset;

  this.legs[idx].hip.servo.to( hip );
  this.legs[idx].knee.servo.to( knee );
};

/**********************************************************
* adjust the legs positions to the rotations of the provided 
* angles for each leg
* @param angles object-array [{ hip:int, knee:int },...]
**********************************************************/
Felix.prototype._legsPositionByAngles = function(angles){
  for(var i = 0; i < angles.length;i++){
    var hip = angles[i].hip + this.legs[i].hip.offset;
    var knee = angles[i].knee + this.legs[i].knee.offset;
    this.legs[i].hip.servo.to( hip );
    this.legs[i].knee.servo.to( knee );
  }
}

/**********************************************************
* generate an array of keypoints along a linear trajectory
* @param line object {a:{x:int,y:int}, b:{x:int,y:int} }
* @param granularity int (optional) how many keypoints should there be along the trajectory
* @param skip_start_point boolean if this trajectory is part of a larger segment, 
*                           the first point will repeat the last point of 
*                           the previous trajectory
* @return trajectory array list of end-points
**********************************************************/
Felix.prototype._linearTrajectory = function(line,granularity,skip_start_point){
    var trajectory = [];
    var granularity = granularity || 8;

    //find the slope/delta
    var delta_x = line.b.x - line.a.x;
    var delta_y = line.b.y - line.a.y;

    //calculate the distance between the two points
    var distance = Math.sqrt( ((delta_x) * (delta_x)) + ((delta_y) * (delta_y)) );

    if(distance == 0) return [];

    //divide the line int the required number of points
    //decrease the granularity one step to be able to include the end point
    var skip = (skip_start_point)? 0:1;

    var step_size = distance / (granularity - skip);
    var c_step = (skip_start_point)? step_size:0;

    for(var i=0;i < granularity;i++){
        var inc = c_step / distance;

        trajectory.push({
                          x:Math.round(line.a.x + (inc * delta_x)),
                          y:Math.round(line.a.y + (inc * delta_y))
                        });
        c_step+= step_size;
     }
     return trajectory; 
}

/**********************************************************
* generate an array of keypoints along an elliptical trajectory
* @param arc object {origin:{x:int,y:int}, radius:{x:int,y:int}, start_angle:int, end_angle: int }
* @param granularity int (optional) how many keypoints should there be along the trajectory
* @param skip_start_point boolean if this trajectory is part of a larger segment, 
*                           the first point will repeat the last point of 
*                           the previous trajectory
* @return trajectory array list of end-points
**********************************************************/
Felix.prototype._ellipticalTrajectory = function(arc,granularity,skip_start_point){
      var trajectory = [];
      granularity = granularity || 8;

      //divide the angles int the required number of points
      //decrease the granularity one step to be able to include the end point
      var skip = (skip_start_point)? 0:1;
      var step_size = (arc.end_angle - arc.start_angle) / (granularity - skip);
      var c_angle = arc.start_angle;
      
      if(skip_start_point) c_angle+= step_size;
      
      for(var i=0;i < granularity;i++){
        var x = arc.origin.x + arc.radius.x * Math.cos(Math.radians(c_angle));
        var y = arc.origin.y + arc.radius.y * Math.sin(Math.radians(c_angle));

        trajectory.push({ x:Math.round(x),y:Math.round(y) });
        c_angle+= step_size;
      }
      return trajectory;
}

/**********************************************************
* Given a leg id return the leg array index
* @param id string eg. FR (front right leg)
* @return idx int reference index to leg
**********************************************************/
Felix.prototype._legIdx = function(id){
  for(var i = 0 ; i < this.legs.length; i++){
    if(this.legs[i].id == id) return i;
  }
  throw Error('no leg with id:'+ id +' in array');
};

/**********************************************************
* Inverse Kinematic function for a two link planar system.
* Given the size of the two links an a desired position,
* it returns the angles for both links
* @param L1 scalar length of the first link
* @param L2 scalar length of the second link
* @param P1 origin point object {x:int, y:int}
* @param P2 end-point object {x:int, y:int}
* @return angles object {hip:int, knee:int}
**********************************************************/
Felix.prototype._IK = function(L1, L2, P1 , P2){
  var H1 = P2.x - P1.x; //delta on the x axis
  var H2 = P2.y - P1.y; //delta on the y axis

  //this is the hypothenuse between the origin and the target
  var K = Math.sqrt( Math.pow(H1,2) + Math.pow(H2,2));

  //the hypothenuse can not be larget the the sum of the segments
  if( K > (L1 + L2 )) K = L1 + L2;

  //knee rotational angle
  var A1 = Math.acos(( Math.pow(L1,2) + Math.pow(L2,2) - Math.pow(K,2))/ (2 * L1 * L2));

  //get the angle between the hypothenuse and the first segment (femur)
  var A2 = Math.acos( (Math.pow(K,2) + Math.pow(L1,2) - Math.pow(L2,2)) / (2 * K * L1));

  //get the angle between the hypothenuse and the x axis
  var A3 = Math.asin(H1/K);

  //get the hip rotational angle
  var A4 = (Math.PI / 2) - (A2 + A3); //add the two angles, substract it from half a circle

  return { hip:Math.round(Math.degrees(A4)), knee:Math.round(Math.degrees(A1)) };
}

/**********************************************************
* find the leg on the other side of the requested leg 
* @param id string leg id 
* @return id string leg id
**********************************************************/
Felix.prototype._oppositeLeg = function(id){
  var legs = { FR:'FL', BR:'BL', FL:'FR', BL:'BR' };
  return legs[id];
}

/**********************************************************
* find the leg in front or behing the requested leg
* @param id string leg id 
* @return id string leg id
**********************************************************/
Felix.prototype._samesideLeg = function(id){
  var legs = { FR:'BR', BR:'FR', FL:'BL', BL:'FL'};
  return legs[id];
}

/**********************************************************
* find the leg diagonal accross the requeted leg
* @param id string leg id 
* @return id string leg id
**********************************************************/
Felix.prototype._diagonalLeg = function(id){
  var legs = { FR:'BL', BR:'FL', FL:'BR',BL:'FR'};
  return legs[id];
}

/**********************************************************
* Utility method to convert radians to degrees
* @param radians float
* @return degrees float
**********************************************************/
Math.degrees = function(rad)
{
 return rad*(180/Math.PI);
}
 
/**********************************************************
* Utility method to convert degrees to radians 
* @param degrees float
* @return radians float
**********************************************************/
Math.radians = function(deg)
{
 return deg * (Math.PI/180);
}

exports.Felix = Felix;

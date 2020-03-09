// @ts-check
let crawlerIsRunning = false;

module.exports = {
  staking: async function (api, pool) {
    
    // Subscribe to new blocks
    await api.rpc.chain.subscribeNewHeads( async (header) => {

      let currentDBIndex;
  
      // Get block number
      const blockNumber = header.number.toNumber();
      // console.log(`[PolkaStats backend v3] - Staking crawler - \x1b[33mNew block #${blockNumber}\x1b[0m`);
  
      // Get last index stored in DB
      const sqlSelect = `SELECT session_index FROM validator_staking ORDER BY session_index DESC LIMIT 1`;
      const res = await pool.query(sqlSelect);
      if (res.rows.length > 0) {
        currentDBIndex = parseInt(res.rows[0]["session_index"]);
        // console.log(`[PolkaStats backend v3] - Staking crawler - \x1b[33mLast session index stored in DB is #${currentDBIndex}\x1b[0m`);
      } else {
        currentDBIndex = 0;
        if (!crawlerIsRunning) {
          console.log(`[PolkaStats backend v3] - Staking crawler - \x1b[33mFirst execution, no session index found in DB!\x1b[0m`);
        }
      }
  
      // Get current session index
      const session = await api.derive.session.info();
      const currentIndex = session.currentIndex.toNumber();
      // console.log(`[PolkaStats backend v3] - Staking crawler - \x1b[32mCurrent session index is #${currentIndex}\x1b[0m`);
      
      if (currentIndex > currentDBIndex) {
        if (!crawlerIsRunning) {
          await module.exports.storeStakingInfo(api, pool, blockNumber, currentIndex);
        }
      }
    });
  },
  storeStakingInfo: async function (api, pool, blockNumber, currentIndex) {
    crawlerIsRunning = true;
    console.log(`[PolkaStats backend v3] - Staking crawler - \x1b[33mStoring validators staking info for at block #${blockNumber} (session #${currentIndex})\x1b[0m`);
  
    //
    // Get active validators, imOnline data, current elected and current era points earned
    //
    const [validators, imOnline, currentElected, currentEraPointsEarned] = await Promise.all([
      api.query.session.validators(),
      api.derive.imOnline.receivedHeartbeats(),
      api.query.staking.currentElected(),
      api.query.staking.currentEraPointsEarned()
    ]);
  
    //
    // Map validator authorityId to staking info object
    //
    const validatorStaking = await Promise.all(
      validators.map(authorityId => api.derive.staking.account(authorityId))
    );
  
    //
    // Add hex representation of sessionId[] and nextSessionId[]
    //
    validatorStaking.forEach(validator => {
      validator.sessionIdHex = validator.sessionIds.length !== 0 ? validator.sessionIds.toHex() : ``;
      validator.nextSessionIdHex = validator.nextSessionIds.length !== 0 ? validator.nextSessionIds.toHex() : ``;
    })
  
    //
    // Add imOnline property to validator object
    //
    validatorStaking.forEach(function (validator) {
      if (imOnline[validator.accountId]) {
        validator.imOnline = imOnline[validator.accountId];
      }
    }, imOnline);
  
    //
    // Add current elected and earned era points to validator object
    //
    for(let i = 0; i < validatorStaking.length; i++) {
      let validator = validatorStaking[i];
      if (Number.isInteger(currentElected.indexOf(validator.accountId))) {
        validator.currentElected = true;
      } else {
        validator.currentElected = false;
      }
      if (currentEraPointsEarned.individual[currentElected.indexOf(validator.accountId)]) {
        validator.currentEraPointsEarned = currentEraPointsEarned.individual[currentElected.indexOf(validator.accountId)];
      }
    }
  
    if (validatorStaking) {
      let sqlInsert = `INSERT INTO validator_staking (block_number, session_index, json, timestamp) VALUES ('${blockNumber}', '${currentIndex}', '${JSON.stringify(validatorStaking)}', extract(epoch from now()));`;
      try {
        await pool.query(sqlInsert);
      } catch (error) {
        // console.log(`[PolkaStats backend v3] - Staking crawler - \x1b[31mSQL: ${sqlInsert}\x1b[0m`);
        console.log(`[PolkaStats backend v3] - Staking crawler - \x1b[31mERROR: ${JSON.stringify(error)}\x1b[0m`);
      }
    }
    
    //
    // Fetch intention validators
    //
    console.log(`[PolkaStats backend v3] - Staking crawler - \x1b[33mStoring intentions staking info at block #${blockNumber} (session #${currentIndex})\x1b[0m`);
    const intentionValidators = await api.query.staking.validators();
    const intentions = intentionValidators[0];
  
    //
    // Map validator authorityId to staking info object
    //
    const intentionStaking = await Promise.all(
      intentions.map(authorityId => api.derive.staking.account(authorityId))
    );
  
    //
    // Add hex representation of sessionId[] and nextSessionId[]
    //
    for(let i = 0; i < intentionStaking.length; i++) {
      let intention = intentionStaking[i];
      if (intention.sessionIds.length > 0) {
        intention.sessionIdHex = intention.sessionIds.toHex();
      }
      if (intention.nextSessionIds.length > 0) {
        intention.nextSessionIdHex = intention.nextSessionIds.toHex();
      }
    }
  
    if (intentionStaking) {
      let sqlInsert = `INSERT INTO intention_staking (block_number, session_index, json, timestamp) VALUES ('${blockNumber}', '${currentIndex}', '${JSON.stringify(intentionStaking)}', extract(epoch from now()));`;
      try {
        await pool.query(sqlInsert);
      } catch (error) {
        // console.log(`[PolkaStats backend v3] - Staking crawler - \x1b[31mSQL: ${sqlInsert}\x1b[0m`);
        console.log(`[PolkaStats backend v3] - Staking crawler - \x1b[31mERROR: ${JSON.stringify(error)}\x1b[0m`);
      }
    }
    
    crawlerIsRunning = false;
  }
}
    
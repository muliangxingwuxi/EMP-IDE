import basicRepl from "./basicRepl"

let webRepl = {
  onOpen: basicRepl.onOpen,
  onClose: basicRepl.onClose,
  onMessage: function (event) {
    if (event.data instanceof ArrayBuffer) {
      var data = new Uint8Array(event.data);
      switch (this.$dtp.binaryState) {
        case 11:
          // first response for put
          if (this.decodeResp(data) == 0) {
            // send file data in chunks
            for (
              var offset = 0; offset < this.$dtp.putFileData.length; offset += 1024
            ) {
              this.$ws.send(this.$dtp.putFileData.slice(offset, offset + 1024));
            }
            this.$dtp.binaryState = 12;
          }

          break;
        case 12:
          // final response for put
          this.$send(this.SIGNAL_UNLOCK(this));
          if (this.decodeResp(data) == 0) {
            this.$toast.success(
              "success! " +
              this.$dtp.putFilename +
              ", " +
              this.$dtp.putFileData.length +
              " bytes"
            );
            this.$dtp.putFileData = null;
            this.$dtp.putFilename = "";
          } else {
            this.$toast.error("Failed sending " + this.$dtp.putFilename);
          }
          this.$dtp.binaryState = 0;
          this.$ws.send("\r\r");
          // this.$ws.send('tree()\r');
          this.$ws.send(this.$emp.tree());
          setTimeout(() => this.$send(this.SIGNAL_PUT_NEXT_FILE(this)), 300);
          setTimeout(() => this.slotClearTerm(), 300);

          break;

        case 21:
          // first response for get
          if (this.decodeResp(data) == 0) {
            this.$dtp.binaryState = 22;
            let rec = new Uint8Array(1);
            rec[0] = 0;
            this.$ws.send(rec);
          }
          break;

        case 22:
          {
            // file data
            var sz = data[0] | (data[1] << 8);
            if (data.length == 2 + sz) {
              // we assume that the data comes in single chunks
              if (sz == 0) {
                // end of file
                this.$dtp.binaryState = 23;
              } else {
                // accumulate incoming data to this.$dtp.getFileData
                var new_buf = new Uint8Array(this.$dtp.getFileData.length + sz);
                new_buf.set(this.$dtp.getFileData);
                new_buf.set(data.slice(2), this.$dtp.getFileData.length);
                this.$dtp.getFileData = new_buf;
                // this.$toast.info('Getting ' + this.$dtp.getFilename + ', ' + this.$dtp.getFileData.length + ' bytes');
                var rec = new Uint8Array(1);
                rec[0] = 0;
                this.$ws.send(rec);
              }
            } else {
              this.$dtp.binaryState = 0;
            }
            break;
          }
        case 23:
          // final response
          // this.$send(this.SIGNAL_UNLOCK(this)); 为什么在这里无法调用 send函数?
          if (this.decodeResp(data) == 0) {
            this.$toast.success(
              "Got " +
              this.$dtp.getFilename +
              ", " +
              this.$dtp.getFileData.length +
              " bytes"
            );
            var code = new TextDecoder("utf-8").decode(this.$dtp.getFileData);
            this.$send(this.SIGNAL_SHOW_CODES(this, code));
          } else {
            this.$toast.error("Failed getting " + this.$dtp.getFilename);
          }
          this.$dtp.getFileData = null;
          this.$dtp.getFilename = null;
          this.$dtp.binaryState = 0;
          this.$ws.send("\r\r");

          setTimeout(() => this.slotClearTerm(), 300);
          break;
      }
    }
    try {
      // console.log(event.data)
      this.$dtp.recData = JSON.parse(event.data);
      if (this.$dtp.recData.func === this.$emp.funcName(this.$emp.tree)) {
        this.$send(this.SIGNAL_UPDATE_TREE(this, [this.$dtp.recData.data]));
        this.$send(this.SIGNAL_UPDATE_FINDER(this, this.$dtp.recData.data));
        this.$send(this.SIGNAL_SHOW_PANE(this));
      }
      if (this.$dtp.recData.func === this.$emp.funcName(this.$emp.getCode))
        this.$send(this.SIGNAL_SHOW_CODES_PMAX(this, this.$dtp.recData.data));
      if (this.$dtp.recData.func === this.$emp.funcName(this.$emp.memoryAnalysing))
        this.$send(
          this.SIGNAL_DEPENDS_ON_MEMORY_TO_GET_FILE(this, this.$dtp.recData.data)
        );
      if (this.$dtp.recData.func === this.$emp.funcName(this.$emp.deviceInfo))
        this.$send(this.SIGNAL_SHOW_SYS_INFO(this, this.$dtp.recData.data));
      if (this.$dtp.recData.func === this.$emp.funcName(this.$emp.memoryStatus))
        this.$send(this.SIGNAL_SHOW_MEMORY_STATUS(this, this.$dtp.recData.data));
    } catch (e) {
      // 容错处理放在这儿
      if (event.data.indexOf("Traceback (most recent call last):") >= 0) {
        this.$send(this.SIGNAL_UNLOCK(this));
      }
    }

  },

  decodeResp(data) {
    if (data[0] == "W".charCodeAt(0) && data[1] == "B".charCodeAt(0)) {
      var code = data[2] | (data[3] << 8);
      return code;
    } else {
      return -1;
    }
  },

  putFile: function (kwargs) {
    if (!this.tasklock) {
      if (kwargs.fileData.length > 0) this.putFileData = kwargs.fileData;
      else {
        this.putFileData = new TextEncoder().encode(" ");
        kwargs.fileData = new TextEncoder().encode(" ");
      }

      var dest_fname = kwargs.filename;
      var dest_fsize = kwargs.fileData.length;

      // WEBREPL_FILE = "<2sBBQLH64s"
      var rec = new Uint8Array(2 + 1 + 1 + 8 + 4 + 2 + 64);
      rec[0] = "W".charCodeAt(0);
      rec[1] = "A".charCodeAt(0);
      rec[2] = 1; // put
      rec[3] = 0;
      rec[4] = 0;
      rec[5] = 0;
      rec[6] = 0;
      rec[7] = 0;
      rec[8] = 0;
      rec[9] = 0;
      rec[10] = 0;
      rec[11] = 0;
      rec[12] = dest_fsize & 0xff;
      rec[13] = (dest_fsize >> 8) & 0xff;
      rec[14] = (dest_fsize >> 16) & 0xff;
      rec[15] = (dest_fsize >> 24) & 0xff;
      rec[16] = dest_fname.length & 0xff;
      rec[17] = (dest_fname.length >> 8) & 0xff;
      for (var i = 0; i < 64; ++i) {
        if (i < dest_fname.length) {
          rec[18 + i] = dest_fname.charCodeAt(i);
        } else {
          rec[18 + i] = 0;
        }
      }

      // initiate put
      this.$binaryState = 11;
      // this.show_message("Sending " + put_file_name + "...");
      this.$toast.info("Sending " + kwargs.filename + "...");
      this.$send(this.SIGNAL_LOCK(this));
      this.$ws.send(rec);
    } else {
      this.$toast.error("IO busy");
    }
  },

  getFile: function (kwargs) {
    var src_fname = kwargs.filename;
    // WEBREPL_FILE = "<2sBBQLH64s"
    var rec = new Uint8Array(2 + 1 + 1 + 8 + 4 + 2 + 64);
    rec[0] = "W".charCodeAt(0);
    rec[1] = "A".charCodeAt(0);
    rec[2] = 2; // get
    rec[3] = 0;
    rec[4] = 0;
    rec[5] = 0;
    rec[6] = 0;
    rec[7] = 0;
    rec[8] = 0;
    rec[9] = 0;
    rec[10] = 0;
    rec[11] = 0;
    rec[12] = 0;
    rec[13] = 0;
    rec[14] = 0;
    rec[15] = 0;
    rec[16] = src_fname.length & 0xff;
    rec[17] = (src_fname.length >> 8) & 0xff;
    for (var i = 0; i < 64; ++i) {
      if (i < src_fname.length) {
        rec[18 + i] = src_fname.charCodeAt(i);
      } else {
        rec[18 + i] = 0;
      }
    }
    // initiate get
    this.$binaryState = 21;
    this.getFilename = src_fname;
    this.getFileData = new Uint8Array(0);
    this.$toast.info("Getting " + this.getFilename + "...");
    this.$ws.send(rec);
  }
}

let countString = function (string, subString) {

  string += "";
  subString += "";
  let n = 0;
  let pos = 0;
  if (subString.length <= 0)
    return 0
  while (true) {
    pos = string.indexOf(subString, pos);
    if (pos >= 0) {
      n += 1;
      pos += 1;

    } else break
  }
  return n;
};

export default webRepl
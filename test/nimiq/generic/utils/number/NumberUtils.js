class NumberUtils {
    static isUint8(val) {
        return Number.isInteger(val)
            && val >= 0 && val <= NumberUtils.UINT8_MAX;
    }

    static isUint16(val) {
        return Number.isInteger(val)
            && val >= 0 && val <= NumberUtils.UINT16_MAX;
    }

    static isUint32(val) {
        return Number.isInteger(val)
            && val >= 0 && val <= NumberUtils.UINT32_MAX;
    }

    static isUint64(val) {
        return Number.isInteger(val)
            && val >= 0 && val <= NumberUtils.UINT64_MAX;
    }
}

NumberUtils.UINT8_MAX = 255;
NumberUtils.UINT16_MAX = 65535;
NumberUtils.UINT32_MAX = 4294967295;
NumberUtils.UINT64_MAX = Number.MAX_SAFE_INTEGER;
Object.freeze(NumberUtils);
Class.register(NumberUtils);
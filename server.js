const express = require('express');
const axios = require('axios');
const cors = require('cors');
const FormData = require('form-data');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const openApi = require('@volcengine/openapi')

const ACCESS_KEY = process.env.ACCESS_KEY || 'AKLTMGM2NGI2MmVhYTA0NDAyNzg3NmJiNzI0MzBmOWU1OWE';
const SECRET_KEY = process.env.SECRET_KEY || 'WkdZNVlXSm1NekV6WldKbU5EazFOemcwTURReVpXVTRaRE0wWVRRd1l6TQ==';
const HOST = 'visual.volcengineapi.com';
const SERVICE = 'cv';
const Action = 'AIGCStylizeImage';
const Version = '2024-06-06';

const STYLE_PARAMS = {
    '3D风': {
        req_key: 'img2img_disney_3d_style',
        sub_req_key: ''
    },
    '动漫风': {
        req_key: 'img2img_cartoon_style',
        sub_req_key: ''
    },
    '新莫奈花园': {
        req_key: 'i2i_ai_create_monet',
        sub_req_key: ''
    },
    '丑萌粘土': {
        req_key: 'img2img_clay_style',
        sub_req_key: 'img2img_clay_style_3d'
    }
};

// 添加根路径处理
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'camera.html'));
});

app.post('/api/style-transfer', async (req, res) => {
    try {
        const { style } = req.body;

        if (!style) {
            return res.status(400).json({ 
                error: '缺少风格参数',
                message: '请选择有效的风格'
            });
        }

        const styleParams = STYLE_PARAMS[style];
        if (!styleParams) {
            return res.status(400).json({ 
                error: '无效的风格选择',
                message: `不支持的风格: ${style}`
            });
        }

        const openApiRequestData = {
            region: 'cn-north-1',
            method: 'POST',
            // [optional] http request url query
            params: {
                Version: Version,
                Action: Action,
            },
            // http request headers
            headers: {
                'Content-Type': 'application/json',
                'Host': HOST,
            },
            // [optional] http request body
            body: {
                req_key: styleParams.req_key,
                binary_data_base64: [req.body.binary_data_base64],  // 使用二进制数据
              ...(styleParams.sub_req_key && { sub_req_key: styleParams.sub_req_key }),
                return_url: true
            },
        }

        const signer = new openApi.Signer(openApiRequestData, SERVICE);
        signer.addAuthorization({accessKeyId: ACCESS_KEY, secretKey: SECRET_KEY});

        const response = await axios({
            method: 'POST',
            url: `https://${HOST}/`,
            headers: openApiRequestData.headers,
            params: {
                Version: Version,
                Action: Action,
            },
            data: {
                req_key: styleParams.req_key,
                binary_data_base64: [req.body.binary_data_base64],  // 使用二进制数据
                ...(styleParams.sub_req_key && { sub_req_key: styleParams.sub_req_key }),
                return_url: true
            }
        });

        // 验证API响应
        if (!response.data || !response.data?.Result?.data?.image_urls || !response.data.Result.data.image_urls.length) {
            return res.status(500).json({ 
                error: 'API响应格式错误',
                message: '风格转换服务返回的数据格式不正确'
            });
        }

        res.json({
            image_url: response.data.Result.data.image_urls[0],
        });
    } catch (error) {
        console.error('Error:', error);
        
        // 根据错误类型返回不同的错误信息
        if (error.response) {
            // API 返回了错误响应
            res.status(error.response.status).json({
                error: '风格转换服务错误',
                message: error.response.data?.message || '风格转换服务返回错误',
                details: error.response.data
            });
        } else if (error.request) {
            // 请求发送失败
            res.status(500).json({
                error: '网络错误',
                message: '无法连接到风格转换服务'
            });
        } else {
            // 其他错误
            res.status(500).json({
                error: '服务器错误',
                message: '处理请求时发生错误'
            });
        }
    }
});

// 添加图片上传端点
app.post('/api/upload-image', async (req, res) => {
    try {
        const { imageData } = req.body;
        if (!imageData) {
            return res.status(400).json({ error: '缺少图片数据' });
        }

        // 将base64数据转换为Buffer
        const imageBuffer = Buffer.from(imageData, 'base64');
        
        // 检查图片大小
        if (imageBuffer.length > 2 * 1024 * 1024) { // 限制在2MB以内
            return res.status(400).json({ 
                error: '图片太大',
                message: '图片大小不能超过2MB'
            });
        }

        const formData = new FormData();
        formData.append('image', imageBuffer, {
            filename: 'image.jpg',  // 改为jpg格式
            contentType: 'image/jpeg'
        });

        // 添加重试机制
        let retryCount = 0;
        const maxRetries = 3;
        let lastError = null;

        while (retryCount < maxRetries) {
            try {
                const response = await axios.post('https://api.imgbb.com/1/upload', formData, {
                    params: {
                        key: '6f8aa4338519ff098eead3fb6b3abe1e'
                    },
                    headers: {
                        ...formData.getHeaders(),
                        'Accept': 'application/json'
                    },
                    timeout: 300000, // 300秒超时
                    maxContentLength: 2 * 1024 * 1024, // 限制最大内容长度为2MB
                    maxBodyLength: 2 * 1024 * 1024 // 限制最大请求体长度为2MB
                });

                if (!response.data || !response.data.success) {
                    throw new Error('图片上传失败: ' + (response.data?.error?.message || '未知错误'));
                }

                if (!response.data.data || !response.data.data.url) {
                    throw new Error('未获取到图片URL');
                }

                return res.json({ url: response.data.data.url });
            } catch (error) {
                lastError = error;
                retryCount++;
                if (retryCount < maxRetries) {
                    console.log(`上传失败，第${retryCount}次重试...`, error.message);
                    await new Promise(resolve => setTimeout(resolve, 2000 * retryCount));
                }
            }
        }

        console.error('Upload error:', lastError);
        res.status(500).json({ 
            error: '图片上传失败', 
            message: '上传服务暂时不可用，请稍后重试',
            details: lastError.message 
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ 
            error: '图片上传失败', 
            message: error.message 
        });
    }
});

// 添加错误处理中间件
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        error: '服务器错误',
        message: '处理请求时发生错误'
    });
});

// 修改服务器启动代码
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Trying to kill the process...`);
        // 尝试找到并关闭占用端口的进程
        require('child_process').exec(`npx kill-port ${PORT}`, (error) => {
            if (error) {
                console.error('Failed to kill port:', error);
                process.exit(1);
            } else {
                console.log(`Port ${PORT} has been freed. Restarting server...`);
                server.listen(PORT);
            }
        });
    } else {
        console.error('Server error:', err);
        process.exit(1);
    }
}); 
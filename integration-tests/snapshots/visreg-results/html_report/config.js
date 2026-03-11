report({
  "testSuite": "shaka-visreg",
  "tests": [
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Homepage_0_data-cyhero-section_0_phone.png",
        "test": "../bitmaps_test/demo-ecommerce_Homepage_0_data-cyhero-section_0_phone.png",
        "selector": "[data-cy='hero-section']",
        "fileName": "demo-ecommerce_Homepage_0_data-cyhero-section_0_phone.png",
        "label": "Homepage",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.01,
        "url": "http://localhost:3030/",
        "referenceUrl": "http://localhost:3020/",
        "expect": 0,
        "viewportLabel": "phone",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Homepage_1_data-cyfeatures-section_0_phone.png",
        "test": "../bitmaps_test/demo-ecommerce_Homepage_1_data-cyfeatures-section_0_phone.png",
        "selector": "[data-cy='features-section']",
        "fileName": "demo-ecommerce_Homepage_1_data-cyfeatures-section_0_phone.png",
        "label": "Homepage",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.01,
        "url": "http://localhost:3030/",
        "referenceUrl": "http://localhost:3020/",
        "expect": 0,
        "viewportLabel": "phone",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Homepage_2_document_0_phone.png",
        "test": "../bitmaps_test/demo-ecommerce_Homepage_2_document_0_phone.png",
        "selector": "document",
        "fileName": "demo-ecommerce_Homepage_2_document_0_phone.png",
        "label": "Homepage",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.01,
        "url": "http://localhost:3030/",
        "referenceUrl": "http://localhost:3020/",
        "expect": 0,
        "viewportLabel": "phone",
        "diff": {
          "isSameDimensions": false,
          "dimensionDifference": {
            "width": 0,
            "height": 162
          },
          "rawMisMatchPercentage": 0.2213942307692308,
          "misMatchPercentage": "0.22",
          "analysisTime": 77
        },
        "diffImage": "../bitmaps_test/failed_diff_demo-ecommerce_Homepage_2_document_0_phone.png"
      },
      "status": "fail"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Homepage_0_data-cyhero-section_1_tablet.png",
        "test": "../bitmaps_test/demo-ecommerce_Homepage_0_data-cyhero-section_1_tablet.png",
        "selector": "[data-cy='hero-section']",
        "fileName": "demo-ecommerce_Homepage_0_data-cyhero-section_1_tablet.png",
        "label": "Homepage",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.01,
        "url": "http://localhost:3030/",
        "referenceUrl": "http://localhost:3020/",
        "expect": 0,
        "viewportLabel": "tablet",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Homepage_1_data-cyfeatures-section_1_tablet.png",
        "test": "../bitmaps_test/demo-ecommerce_Homepage_1_data-cyfeatures-section_1_tablet.png",
        "selector": "[data-cy='features-section']",
        "fileName": "demo-ecommerce_Homepage_1_data-cyfeatures-section_1_tablet.png",
        "label": "Homepage",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.01,
        "url": "http://localhost:3030/",
        "referenceUrl": "http://localhost:3020/",
        "expect": 0,
        "viewportLabel": "tablet",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Homepage_2_document_1_tablet.png",
        "test": "../bitmaps_test/demo-ecommerce_Homepage_2_document_1_tablet.png",
        "selector": "document",
        "fileName": "demo-ecommerce_Homepage_2_document_1_tablet.png",
        "label": "Homepage",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.01,
        "url": "http://localhost:3030/",
        "referenceUrl": "http://localhost:3020/",
        "expect": 0,
        "viewportLabel": "tablet",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Homepage_0_data-cyhero-section_2_desktop.png",
        "test": "../bitmaps_test/demo-ecommerce_Homepage_0_data-cyhero-section_2_desktop.png",
        "selector": "[data-cy='hero-section']",
        "fileName": "demo-ecommerce_Homepage_0_data-cyhero-section_2_desktop.png",
        "label": "Homepage",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.01,
        "url": "http://localhost:3030/",
        "referenceUrl": "http://localhost:3020/",
        "expect": 0,
        "viewportLabel": "desktop",
        "diff": {
          "isSameDimensions": false,
          "dimensionDifference": {
            "width": 0,
            "height": -64
          },
          "rawMisMatchPercentage": 4.992173005565863,
          "misMatchPercentage": "4.99",
          "analysisTime": 98
        },
        "diffImage": "../bitmaps_test/failed_diff_demo-ecommerce_Homepage_0_data-cyhero-section_2_desktop.png"
      },
      "status": "fail"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Homepage_1_data-cyfeatures-section_2_desktop.png",
        "test": "../bitmaps_test/demo-ecommerce_Homepage_1_data-cyfeatures-section_2_desktop.png",
        "selector": "[data-cy='features-section']",
        "fileName": "demo-ecommerce_Homepage_1_data-cyfeatures-section_2_desktop.png",
        "label": "Homepage",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.01,
        "url": "http://localhost:3030/",
        "referenceUrl": "http://localhost:3020/",
        "expect": 0,
        "viewportLabel": "desktop",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Homepage_2_document_2_desktop.png",
        "test": "../bitmaps_test/demo-ecommerce_Homepage_2_document_2_desktop.png",
        "selector": "document",
        "fileName": "demo-ecommerce_Homepage_2_document_2_desktop.png",
        "label": "Homepage",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.01,
        "url": "http://localhost:3030/",
        "referenceUrl": "http://localhost:3020/",
        "expect": 0,
        "viewportLabel": "desktop",
        "diff": {
          "isSameDimensions": false,
          "dimensionDifference": {
            "width": 0,
            "height": -64
          },
          "rawMisMatchPercentage": 22.084054709141274,
          "misMatchPercentage": "22.08",
          "analysisTime": 79
        },
        "diffImage": "../bitmaps_test/failed_diff_demo-ecommerce_Homepage_2_document_2_desktop.png"
      },
      "status": "fail"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Products_List_0_document_0_phone.png",
        "test": "../bitmaps_test/demo-ecommerce_Products_List_0_document_0_phone.png",
        "selector": "document",
        "fileName": "demo-ecommerce_Products_List_0_document_0_phone.png",
        "label": "Products List",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.1,
        "url": "http://localhost:3030/products",
        "referenceUrl": "http://localhost:3020/products",
        "expect": 0,
        "viewportLabel": "phone",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Products_List_0_document_1_tablet.png",
        "test": "../bitmaps_test/demo-ecommerce_Products_List_0_document_1_tablet.png",
        "selector": "document",
        "fileName": "demo-ecommerce_Products_List_0_document_1_tablet.png",
        "label": "Products List",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.1,
        "url": "http://localhost:3030/products",
        "referenceUrl": "http://localhost:3020/products",
        "expect": 0,
        "viewportLabel": "tablet",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Products_List_0_document_2_desktop.png",
        "test": "../bitmaps_test/demo-ecommerce_Products_List_0_document_2_desktop.png",
        "selector": "document",
        "fileName": "demo-ecommerce_Products_List_0_document_2_desktop.png",
        "label": "Products List",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.1,
        "url": "http://localhost:3030/products",
        "referenceUrl": "http://localhost:3020/products",
        "expect": 0,
        "viewportLabel": "desktop",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Products_-_Electronics_Filter_0_document_0_phone.png",
        "test": "../bitmaps_test/demo-ecommerce_Products_-_Electronics_Filter_0_document_0_phone.png",
        "selector": "document",
        "fileName": "demo-ecommerce_Products_-_Electronics_Filter_0_document_0_phone.png",
        "label": "Products - Electronics Filter",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.1,
        "url": "http://localhost:3030/products",
        "referenceUrl": "http://localhost:3020/products",
        "expect": 0,
        "viewportLabel": "phone",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Products_-_Electronics_Filter_0_document_1_tablet.png",
        "test": "../bitmaps_test/demo-ecommerce_Products_-_Electronics_Filter_0_document_1_tablet.png",
        "selector": "document",
        "fileName": "demo-ecommerce_Products_-_Electronics_Filter_0_document_1_tablet.png",
        "label": "Products - Electronics Filter",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.1,
        "url": "http://localhost:3030/products",
        "referenceUrl": "http://localhost:3020/products",
        "expect": 0,
        "viewportLabel": "tablet",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Products_-_Electronics_Filter_0_document_2_desktop.png",
        "test": "../bitmaps_test/demo-ecommerce_Products_-_Electronics_Filter_0_document_2_desktop.png",
        "selector": "document",
        "fileName": "demo-ecommerce_Products_-_Electronics_Filter_0_document_2_desktop.png",
        "label": "Products - Electronics Filter",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.1,
        "url": "http://localhost:3030/products",
        "referenceUrl": "http://localhost:3020/products",
        "expect": 0,
        "viewportLabel": "desktop",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Product_Detail_0_document_0_phone.png",
        "test": "../bitmaps_test/demo-ecommerce_Product_Detail_0_document_0_phone.png",
        "selector": "document",
        "fileName": "demo-ecommerce_Product_Detail_0_document_0_phone.png",
        "label": "Product Detail",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.1,
        "url": "http://localhost:3030/products/1",
        "referenceUrl": "http://localhost:3020/products/1",
        "expect": 0,
        "viewportLabel": "phone",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Product_Detail_0_document_1_tablet.png",
        "test": "../bitmaps_test/demo-ecommerce_Product_Detail_0_document_1_tablet.png",
        "selector": "document",
        "fileName": "demo-ecommerce_Product_Detail_0_document_1_tablet.png",
        "label": "Product Detail",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.1,
        "url": "http://localhost:3030/products/1",
        "referenceUrl": "http://localhost:3020/products/1",
        "expect": 0,
        "viewportLabel": "tablet",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Product_Detail_0_document_2_desktop.png",
        "test": "../bitmaps_test/demo-ecommerce_Product_Detail_0_document_2_desktop.png",
        "selector": "document",
        "fileName": "demo-ecommerce_Product_Detail_0_document_2_desktop.png",
        "label": "Product Detail",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.1,
        "url": "http://localhost:3030/products/1",
        "referenceUrl": "http://localhost:3020/products/1",
        "expect": 0,
        "viewportLabel": "desktop",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Cart_0_document_0_phone.png",
        "test": "../bitmaps_test/demo-ecommerce_Cart_0_document_0_phone.png",
        "selector": "document",
        "fileName": "demo-ecommerce_Cart_0_document_0_phone.png",
        "label": "Cart",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.1,
        "url": "http://localhost:3030/cart",
        "referenceUrl": "http://localhost:3020/cart",
        "expect": 0,
        "viewportLabel": "phone",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Cart_0_document_1_tablet.png",
        "test": "../bitmaps_test/demo-ecommerce_Cart_0_document_1_tablet.png",
        "selector": "document",
        "fileName": "demo-ecommerce_Cart_0_document_1_tablet.png",
        "label": "Cart",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.1,
        "url": "http://localhost:3030/cart",
        "referenceUrl": "http://localhost:3020/cart",
        "expect": 0,
        "viewportLabel": "tablet",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Cart_0_document_2_desktop.png",
        "test": "../bitmaps_test/demo-ecommerce_Cart_0_document_2_desktop.png",
        "selector": "document",
        "fileName": "demo-ecommerce_Cart_0_document_2_desktop.png",
        "label": "Cart",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.1,
        "url": "http://localhost:3030/cart",
        "referenceUrl": "http://localhost:3020/cart",
        "expect": 0,
        "viewportLabel": "desktop",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Admin_Dashboard_-_Cookie_Login_0_document_0_phone.png",
        "test": "../bitmaps_test/demo-ecommerce_Admin_Dashboard_-_Cookie_Login_0_document_0_phone.png",
        "selector": "document",
        "fileName": "demo-ecommerce_Admin_Dashboard_-_Cookie_Login_0_document_0_phone.png",
        "label": "Admin Dashboard - Cookie Login",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.1,
        "url": "http://localhost:3030/admin",
        "referenceUrl": "http://localhost:3020/admin",
        "expect": 0,
        "viewportLabel": "phone",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Admin_Dashboard_-_Cookie_Login_0_document_1_tablet.png",
        "test": "../bitmaps_test/demo-ecommerce_Admin_Dashboard_-_Cookie_Login_0_document_1_tablet.png",
        "selector": "document",
        "fileName": "demo-ecommerce_Admin_Dashboard_-_Cookie_Login_0_document_1_tablet.png",
        "label": "Admin Dashboard - Cookie Login",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.1,
        "url": "http://localhost:3030/admin",
        "referenceUrl": "http://localhost:3020/admin",
        "expect": 0,
        "viewportLabel": "tablet",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Admin_Dashboard_-_Cookie_Login_0_document_2_desktop.png",
        "test": "../bitmaps_test/demo-ecommerce_Admin_Dashboard_-_Cookie_Login_0_document_2_desktop.png",
        "selector": "document",
        "fileName": "demo-ecommerce_Admin_Dashboard_-_Cookie_Login_0_document_2_desktop.png",
        "label": "Admin Dashboard - Cookie Login",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.1,
        "url": "http://localhost:3030/admin",
        "referenceUrl": "http://localhost:3020/admin",
        "expect": 0,
        "viewportLabel": "desktop",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Admin_Orders_-_Form_Login_Interaction_0_document_0_phone.png",
        "test": "../bitmaps_test/demo-ecommerce_Admin_Orders_-_Form_Login_Interaction_0_document_0_phone.png",
        "selector": "document",
        "fileName": "demo-ecommerce_Admin_Orders_-_Form_Login_Interaction_0_document_0_phone.png",
        "label": "Admin Orders - Form Login Interaction",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.1,
        "url": "http://localhost:3030/admin/orders",
        "referenceUrl": "http://localhost:3020/admin/orders",
        "expect": 0,
        "viewportLabel": "phone",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Admin_Orders_-_Form_Login_Interaction_0_document_1_tablet.png",
        "test": "../bitmaps_test/demo-ecommerce_Admin_Orders_-_Form_Login_Interaction_0_document_1_tablet.png",
        "selector": "document",
        "fileName": "demo-ecommerce_Admin_Orders_-_Form_Login_Interaction_0_document_1_tablet.png",
        "label": "Admin Orders - Form Login Interaction",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.1,
        "url": "http://localhost:3030/admin/orders",
        "referenceUrl": "http://localhost:3020/admin/orders",
        "expect": 0,
        "viewportLabel": "tablet",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Admin_Orders_-_Form_Login_Interaction_0_document_2_desktop.png",
        "test": "../bitmaps_test/demo-ecommerce_Admin_Orders_-_Form_Login_Interaction_0_document_2_desktop.png",
        "selector": "document",
        "fileName": "demo-ecommerce_Admin_Orders_-_Form_Login_Interaction_0_document_2_desktop.png",
        "label": "Admin Orders - Form Login Interaction",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.1,
        "url": "http://localhost:3030/admin/orders",
        "referenceUrl": "http://localhost:3020/admin/orders",
        "expect": 0,
        "viewportLabel": "desktop",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Carousel_Demo_-_Pause_With_Override_CSS_0_document_0_phone.png",
        "test": "../bitmaps_test/demo-ecommerce_Carousel_Demo_-_Pause_With_Override_CSS_0_document_0_phone.png",
        "selector": "document",
        "fileName": "demo-ecommerce_Carousel_Demo_-_Pause_With_Override_CSS_0_document_0_phone.png",
        "label": "Carousel Demo - Pause With Override CSS",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.1,
        "url": "http://localhost:3030/carousel-demo",
        "referenceUrl": "http://localhost:3020/carousel-demo",
        "expect": 0,
        "viewportLabel": "phone",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Carousel_Demo_-_Pause_With_Override_CSS_0_document_1_tablet.png",
        "test": "../bitmaps_test/demo-ecommerce_Carousel_Demo_-_Pause_With_Override_CSS_0_document_1_tablet.png",
        "selector": "document",
        "fileName": "demo-ecommerce_Carousel_Demo_-_Pause_With_Override_CSS_0_document_1_tablet.png",
        "label": "Carousel Demo - Pause With Override CSS",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.1,
        "url": "http://localhost:3030/carousel-demo",
        "referenceUrl": "http://localhost:3020/carousel-demo",
        "expect": 0,
        "viewportLabel": "tablet",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Carousel_Demo_-_Pause_With_Override_CSS_0_document_2_desktop.png",
        "test": "../bitmaps_test/demo-ecommerce_Carousel_Demo_-_Pause_With_Override_CSS_0_document_2_desktop.png",
        "selector": "document",
        "fileName": "demo-ecommerce_Carousel_Demo_-_Pause_With_Override_CSS_0_document_2_desktop.png",
        "label": "Carousel Demo - Pause With Override CSS",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.1,
        "url": "http://localhost:3030/carousel-demo",
        "referenceUrl": "http://localhost:3020/carousel-demo",
        "expect": 0,
        "viewportLabel": "desktop",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Carousel_Demo_-_Stub_Slider_Images_0_document_0_phone.png",
        "test": "../bitmaps_test/demo-ecommerce_Carousel_Demo_-_Stub_Slider_Images_0_document_0_phone.png",
        "selector": "document",
        "fileName": "demo-ecommerce_Carousel_Demo_-_Stub_Slider_Images_0_document_0_phone.png",
        "label": "Carousel Demo - Stub Slider Images",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.1,
        "url": "http://localhost:3030/carousel-demo",
        "referenceUrl": "http://localhost:3020/carousel-demo",
        "expect": 0,
        "viewportLabel": "phone",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Carousel_Demo_-_Stub_Slider_Images_0_document_1_tablet.png",
        "test": "../bitmaps_test/demo-ecommerce_Carousel_Demo_-_Stub_Slider_Images_0_document_1_tablet.png",
        "selector": "document",
        "fileName": "demo-ecommerce_Carousel_Demo_-_Stub_Slider_Images_0_document_1_tablet.png",
        "label": "Carousel Demo - Stub Slider Images",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.1,
        "url": "http://localhost:3030/carousel-demo",
        "referenceUrl": "http://localhost:3020/carousel-demo",
        "expect": 0,
        "viewportLabel": "tablet",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    },
    {
      "pair": {
        "reference": "../bitmaps_reference/demo-ecommerce_Carousel_Demo_-_Stub_Slider_Images_0_document_2_desktop.png",
        "test": "../bitmaps_test/demo-ecommerce_Carousel_Demo_-_Stub_Slider_Images_0_document_2_desktop.png",
        "selector": "document",
        "fileName": "demo-ecommerce_Carousel_Demo_-_Stub_Slider_Images_0_document_2_desktop.png",
        "label": "Carousel Demo - Stub Slider Images",
        "requireSameDimensions": true,
        "misMatchThreshold": 0.1,
        "url": "http://localhost:3030/carousel-demo",
        "referenceUrl": "http://localhost:3020/carousel-demo",
        "expect": 0,
        "viewportLabel": "desktop",
        "diff": {
          "isSameDimensions": true,
          "dimensionDifference": {
            "width": 0,
            "height": 0
          },
          "misMatchPercentage": "0.00"
        }
      },
      "status": "pass"
    }
  ],
  "id": "demo-ecommerce"
});
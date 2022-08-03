import * as awsx from "@pulumi/awsx";
import * as aws from "@pulumi/aws"
import * as eks from "@pulumi/eks";
import * as pulumi from "@pulumi/pulumi";
import * as iam from "./iam";
import * as utils from "./utils";
import * as k8s from "@pulumi/kubernetes";

const projectName = pulumi.getProject();

// Get the default VPC and the subnets
const vpc = awsx.ec2.Vpc.getDefault();
export const allVpcSubnets = pulumi.all([vpc.privateSubnetIds, vpc.publicSubnetIds])
                            .apply(([privateSubnetIds, publicSubnetIds]) => privateSubnetIds.concat(publicSubnetIds));

// Create 3 IAM Roles and matching InstanceProfiles to use with the nodegroups.
const roles = iam.createRoles(projectName, 3);
const instanceProfiles = iam.createInstanceProfiles(projectName, roles);

// Create an EKS cluster.
const elkCluster = new eks.Cluster(`${projectName}`, {
    version: "1.22",
    vpcId: vpc.id,
    subnetIds: allVpcSubnets,
    nodeAssociatePublicIpAddress: false,
    skipDefaultNodeGroup: true,
    deployDashboard: false,
    instanceRoles: roles,
    enabledClusterLogTypes: ["api", "audit", "authenticator",
        "controllerManager", "scheduler"],
});
export const kubeconfig = elkCluster.kubeconfig;
export const clusterName = elkCluster.core.cluster.name;

// Create a Standard node group of t2.micro workers.
const ngMicro = utils.createNodeGroup(`${projectName}-ng-micro`, {
    ami: "ami-0e0b320630373ee54", // k8s v1.22 in eu-west-1
    instanceType: "t2.micro",
    desiredCapacity: 2,
    cluster: elkCluster,
    instanceProfile: instanceProfiles[0],
});

const ngSmall = utils.createNodeGroup(`${projectName}-ng-small`, {
    ami: "ami-0e0b320630373ee54", // k8s v1.22 in eu-west-1
    instanceType: "t2.small",
    desiredCapacity: 2,
    cluster: elkCluster,
    instanceProfile: instanceProfiles[1],
});


const elastic = new k8s.helm.v3.Release("elastic", {
    chart: "elasticsearch",
    name: "elastic",
    repositoryOpts: {
        repo: "https://helm.elastic.co"
    }
}, {dependsOn: elkCluster});

const kibana = new k8s.helm.v3.Release("kibana", {
    chart: "kibana",
    name: "elastic",
    repositoryOpts: {
        repo: "https://helm.elastic.co",
    },
    version: "7.x"
}, {dependsOn: elkCluster});

const metricbeat = new k8s.helm.v3.Release("metricbeat", {
    chart: "metricbeat",
    name: "elastic",
    repositoryOpts: {
        repo: "https://helm.elastic.co",
    },
    version: "7.x"
}, {dependsOn: elkCluster});
